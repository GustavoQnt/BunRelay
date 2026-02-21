import { renderPrometheusMetrics, snapshotMetrics } from "../services/metrics.ts";
import { json } from "./utils.ts";

export function handleMetricsRoute(request: Request, url: URL): Response | null {
  if (request.method !== "GET" || url.pathname !== "/ops/metrics") {
    return null;
  }

  return json(snapshotMetrics());
}

export function handleMetricsPromRoute(request: Request, url: URL): Response | null {
  if (request.method !== "GET" || url.pathname !== "/ops/metrics.prom") {
    return null;
  }

  return new Response(renderPrometheusMetrics(), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8"
    }
  });
}
