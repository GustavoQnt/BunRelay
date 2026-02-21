import { clientEventSchema } from "@bunrelay/shared";

import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import {
  observeWsConnectionClose,
  observeWsConnectionOpen,
  observeWsInvalidEnvelope,
  observeWsInvalidJson,
  observeWsMessageIn,
  observeWsMessageInType,
  observeWsRateLimited
} from "../services/metrics.ts";
import { runInSpan } from "../services/observability/tracing.ts";
import { markOffline } from "../services/presence.ts";
import { registerConnection, removeConnection } from "./connections.ts";
import { sendError } from "./events.ts";
import { broadcastPresenceToJoinedRooms } from "./broadcast.ts";
import { routeClientEvent } from "./router.ts";
import type { ConnectionData, ServerSocket } from "./types.ts";

const AUTH_TIMEOUT_MS = env.WS_AUTH_TIMEOUT_MS;
const HEARTBEAT_TIMEOUT_MS = env.WS_HEARTBEAT_TIMEOUT_MS;
const RATE_LIMIT_TOKENS_PER_SEC = env.WS_RATE_LIMIT_PER_SEC;

function payloadBytes(rawMessage: string | Buffer | ArrayBuffer | Uint8Array): number {
  if (typeof rawMessage === "string") {
    return Buffer.byteLength(rawMessage, "utf8");
  }
  if (rawMessage instanceof ArrayBuffer) {
    return rawMessage.byteLength;
  }
  return rawMessage.byteLength;
}

function clearSocketTimer(timer?: Timer): void {
  if (timer) {
    clearTimeout(timer);
  }
}

function refillRateLimit(state: ConnectionData["rateLimit"]): void {
  const now = Date.now();
  const elapsedMs = now - state.lastRefillAt;
  if (elapsedMs <= 0) {
    return;
  }

  const refill = (elapsedMs / 1000) * RATE_LIMIT_TOKENS_PER_SEC;
  state.tokens = Math.min(RATE_LIMIT_TOKENS_PER_SEC, state.tokens + refill);
  state.lastRefillAt = now;
}

function consumeRateLimit(socket: ServerSocket): boolean {
  refillRateLimit(socket.data.rateLimit);
  if (socket.data.rateLimit.tokens < 1) {
    return false;
  }
  socket.data.rateLimit.tokens -= 1;
  return true;
}

function resetHeartbeat(socket: ServerSocket): void {
  clearSocketTimer(socket.data.heartbeatTimeout);
  socket.data.heartbeatTimeout = setTimeout(() => {
    void runInSpan(
      {
        name: "ws.heartbeat.timeout",
        parentTraceparent: socket.data.traceparent,
        requestId: socket.data.requestId,
        connectionId: socket.data.connectionId,
        userId: socket.data.userId,
        attributes: {
          "ws.connection_id": socket.data.connectionId
        }
      },
      async () => {
        sendError(socket, "UNAUTHORIZED", "heartbeat timeout");
        socket.close(4002, "heartbeat timeout");
      }
    ).catch((error) => {
      logger.error("ws.span_error", {
        stage: "heartbeat_timeout",
        connectionId: socket.data.connectionId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, HEARTBEAT_TIMEOUT_MS);
}

async function onDisconnect(socket: ServerSocket) {
  clearSocketTimer(socket.data.authTimeout);
  clearSocketTimer(socket.data.heartbeatTimeout);

  removeConnection(socket.data.userId, socket.data.deviceId, socket);
  logger.debug("ws.disconnect", {
    connectionId: socket.data.connectionId,
    userId: socket.data.userId,
    deviceId: socket.data.deviceId
  });

  if (socket.data.userId) {
    const presence = await markOffline(socket.data.userId);
    if (presence) {
      broadcastPresenceToJoinedRooms(socket.data.joinedRooms, presence, {
        excludeConnectionId: socket.data.connectionId
      });
    }
  }
}

export const wsHandler: Bun.WebSocketHandler<ConnectionData> = {
  open(socket: ServerSocket) {
    void runInSpan(
      {
        name: "ws.connection.open",
        kind: "server",
        parentTraceparent: socket.data.traceparent,
        requestId: socket.data.requestId,
        connectionId: socket.data.connectionId,
        attributes: {
          "ws.connection_id": socket.data.connectionId,
          "net.peer.ip": socket.data.ip
        }
      },
      async (span) => {
        socket.data.traceparent = span.traceparent;

        observeWsConnectionOpen();
        logger.debug("ws.open", {
          connectionId: socket.data.connectionId,
          ip: socket.data.ip
        });

        socket.data.authTimeout = setTimeout(() => {
          void runInSpan(
            {
              name: "ws.auth.timeout",
              parentTraceparent: socket.data.traceparent,
              requestId: socket.data.requestId,
              connectionId: socket.data.connectionId,
              attributes: {
                "ws.connection_id": socket.data.connectionId
              }
            },
            async () => {
              if (socket.data.authed) {
                return;
              }
              sendError(socket, "UNAUTHORIZED", "auth timeout");
              socket.close(4001, "auth timeout");
              logger.warn("ws.auth_timeout", { connectionId: socket.data.connectionId });
            }
          ).catch((error) => {
            logger.error("ws.span_error", {
              stage: "auth_timeout",
              connectionId: socket.data.connectionId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }, AUTH_TIMEOUT_MS);
      }
    ).catch((error) => {
      logger.error("ws.span_error", {
        stage: "open",
        connectionId: socket.data.connectionId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  },

  async message(socket: ServerSocket, rawMessage: string | Buffer | ArrayBuffer | Uint8Array) {
    await runInSpan(
      {
        name: "ws.message",
        kind: "consumer",
        parentTraceparent: socket.data.traceparent,
        requestId: socket.data.requestId,
        connectionId: socket.data.connectionId,
        userId: socket.data.userId,
        attributes: {
          "ws.connection_id": socket.data.connectionId
        }
      },
      async (span) => {
        socket.data.traceparent = span.traceparent;

        observeWsMessageIn();

        const bytes = payloadBytes(rawMessage);
        span.setAttributes({
          "ws.message_size_bytes": bytes
        });

        if (bytes > env.WS_MAX_MESSAGE_BYTES) {
          sendError(socket, "BAD_REQUEST", `message too large (max ${env.WS_MAX_MESSAGE_BYTES} bytes)`);
          logger.warn("ws.payload_too_large", {
            connectionId: socket.data.connectionId,
            bytes
          });
          return;
        }

        if (!consumeRateLimit(socket)) {
          observeWsRateLimited();
          span.setAttributes({
            "ws.rate_limited": true
          });
          sendError(socket, "RATE_LIMITED", "too many events");
          logger.warn("ws.rate_limited", { connectionId: socket.data.connectionId });
          return;
        }

        const payloadText = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();

        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(payloadText);
        } catch {
          observeWsInvalidJson();
          sendError(socket, "BAD_REQUEST", "message must be a valid JSON object");
          logger.warn("ws.invalid_json", { connectionId: socket.data.connectionId });
          return;
        }

        const parsedEvent = clientEventSchema.safeParse(parsedPayload);
        if (!parsedEvent.success) {
          observeWsInvalidEnvelope();
          sendError(socket, "BAD_REQUEST", "invalid event envelope");
          logger.warn("ws.invalid_envelope", {
            connectionId: socket.data.connectionId,
            issues: parsedEvent.error.issues.length
          });
          return;
        }

        observeWsMessageInType(parsedEvent.data.type);
        span.setAttributes({
          "ws.event.type": parsedEvent.data.type
        });

        await routeClientEvent(socket, parsedEvent.data, {
          onAuthenticated: (authedSocket) => {
            clearSocketTimer(authedSocket.data.authTimeout);
            authedSocket.data.authTimeout = undefined;

            if (!authedSocket.data.userId || !authedSocket.data.deviceId) {
              return;
            }

            registerConnection(authedSocket.data.userId, authedSocket.data.deviceId, authedSocket);
          },
          resetHeartbeat
        });
      }
    );
  },

  async close(socket: ServerSocket, code?: number, reason?: string) {
    await runInSpan(
      {
        name: "ws.connection.close",
        parentTraceparent: socket.data.traceparent,
        requestId: socket.data.requestId,
        connectionId: socket.data.connectionId,
        userId: socket.data.userId,
        attributes: {
          "ws.connection_id": socket.data.connectionId,
          "ws.close.code": code ?? 1000,
          "ws.close.reason": reason ?? ""
        }
      },
      async () => {
        observeWsConnectionClose();
        await onDisconnect(socket);
      }
    );
  },

  drain() {}
};
