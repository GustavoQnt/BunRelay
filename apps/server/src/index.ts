import { env } from "./config/env.ts";
import { logger } from "./config/logger.ts";
import { runMigrations } from "./db/migrate.ts";
import { initPubSub, shutdownPubSub } from "./services/pubsub.ts";
import { initBroadcastSubscriptions } from "./ws/broadcast.ts";
import { handleAuthRoute } from "./routes/auth.ts";
import { handleHealthRoute } from "./routes/health.ts";
import { handleMetricsPromRoute, handleMetricsRoute } from "./routes/metrics.ts";
import { handleRoomsRoute } from "./routes/rooms.ts";
import { json } from "./routes/utils.ts";
import { observeHttpRequest, observeWsUpgrade } from "./services/metrics.ts";
import { currentTraceparent, runInSpan, tracingEnabled } from "./services/observability/tracing.ts";
import { wsHandler } from "./ws/handler.ts";
import type { ConnectionData } from "./ws/types.ts";

const PUBLIC_ROOT = new URL("../public/", import.meta.url);

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

function withObservabilityHeaders(response: Response, reqId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", reqId);
  const traceparent = currentTraceparent();
  if (traceparent) {
    headers.set("traceparent", traceparent);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function initialConnectionData(request: Request, reqId: string): ConnectionData {
  return {
    connectionId: crypto.randomUUID(),
    requestId: reqId,
    traceparent: currentTraceparent(),
    ip: clientIp(request),
    authed: false,
    joinedRooms: new Set<string>(),
    rateLimit: {
      tokens: 50,
      lastRefillAt: Date.now()
    }
  };
}

async function servePublic(pathname: string): Promise<Response> {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (relative.includes("..")) {
    return json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "invalid path"
        }
      },
      400
    );
  }

  const file = Bun.file(new URL(relative, PUBLIC_ROOT));
  if (!(await file.exists())) {
    return new Response("not found", { status: 404 });
  }

  return new Response(file);
}

export function createServer(options?: { port?: number; hostname?: string }) {
  return Bun.serve<ConnectionData>({
    hostname: options?.hostname ?? env.HOST,
    port: options?.port ?? env.PORT,
    websocket: wsHandler,
    async fetch(request, serverRef) {
      const url = new URL(request.url);
      const reqId = requestId(request);

      return runInSpan(
        {
          name: `${request.method} ${url.pathname}`,
          kind: "server",
          requestId: reqId,
          parentTraceparent: request.headers.get("traceparent") ?? undefined,
          attributes: {
            "http.method": request.method,
            "http.route": url.pathname,
            "http.target": `${url.pathname}${url.search}`,
            "http.client_ip": clientIp(request)
          }
        },
        async (span) => {
          const startedAt = Date.now();
          let statusCode = 500;
          let upgradedToWs = false;

          try {
            if (url.pathname === "/ws") {
              const upgraded = serverRef.upgrade(request, {
                data: initialConnectionData(request, reqId)
              });

              if (upgraded) {
                upgradedToWs = true;
                observeWsUpgrade();
                span.setAttributes({
                  "ws.upgrade": true
                });
                return;
              }

              const response = new Response("upgrade required", { status: 426 });
              statusCode = response.status;
              return withObservabilityHeaders(response, reqId);
            }

            const health = handleHealthRoute(request, url);
            if (health) {
              statusCode = health.status;
              return withObservabilityHeaders(health, reqId);
            }

            const metrics = handleMetricsRoute(request, url);
            if (metrics) {
              statusCode = metrics.status;
              return withObservabilityHeaders(metrics, reqId);
            }

            const metricsProm = handleMetricsPromRoute(request, url);
            if (metricsProm) {
              statusCode = metricsProm.status;
              return withObservabilityHeaders(metricsProm, reqId);
            }

            const auth = await handleAuthRoute(request, url);
            if (auth) {
              statusCode = auth.status;
              return withObservabilityHeaders(auth, reqId);
            }

            const rooms = await handleRoomsRoute(request, url);
            if (rooms) {
              statusCode = rooms.status;
              return withObservabilityHeaders(rooms, reqId);
            }

            const response = await servePublic(url.pathname);
            statusCode = response.status;
            return withObservabilityHeaders(response, reqId);
          } catch (error) {
            logger.error("http.unhandled_error", {
              requestId: reqId,
              method: request.method,
              path: url.pathname,
              error: error instanceof Error ? error.message : String(error)
            });

            const response = json(
              {
                error: {
                  code: "INTERNAL",
                  message: "internal server error"
                }
              },
              500
            );
            statusCode = response.status;
            return withObservabilityHeaders(response, reqId);
          } finally {
            const durationMs = Date.now() - startedAt;
            span.setAttributes({
              "http.status_code": statusCode,
              "http.duration_ms": durationMs
            });

            if (upgradedToWs) {
              logger.debug("ws.upgrade", {
                requestId: reqId,
                method: request.method,
                path: url.pathname,
                ip: clientIp(request),
                durationMs
              });
            } else {
              observeHttpRequest({
                method: request.method,
                path: url.pathname,
                statusCode,
                durationMs
              });

              logger.info("http.request", {
                requestId: reqId,
                method: request.method,
                path: url.pathname,
                statusCode,
                ip: clientIp(request),
                durationMs
              });
            }
          }
        }
      );
    }
  });
}

if (import.meta.main) {
  await runMigrations();
  await initPubSub(env.REDIS_URL);
  await initBroadcastSubscriptions();
  const server = createServer();
  logger.info("server.started", {
    host: server.hostname,
    port: server.port,
    dbDriver: env.DB_DRIVER,
    redisUrl: env.REDIS_URL ? env.REDIS_URL.replace(/\/\/.*@/, "//***@") : null,
    tracingEnabled: tracingEnabled(),
    tracingBackend: env.TRACING_OTLP_HTTP_URL ?? null,
    externalLogSinks: env.LOG_SINK_HTTP_URLS ?? null
  });

  const shutdown = async () => {
    logger.info("server.shutting_down");
    await shutdownPubSub();
    server.stop(true);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
