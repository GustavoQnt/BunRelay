type CounterMap = Map<string, number>;

function increment(map: CounterMap, key: string, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function mapToObject(map: CounterMap): Record<string, number> {
  return Object.fromEntries(map.entries());
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function pushMetric(lines: string[], name: string, value: number, labels?: Record<string, string>): void {
  if (!labels || Object.keys(labels).length === 0) {
    lines.push(`${name} ${value}`);
    return;
  }

  const labelText = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(",");
  lines.push(`${name}{${labelText}} ${value}`);
}

const state = {
  startedAt: Date.now(),
  httpTotal: 0,
  httpErrorsTotal: 0,
  httpDurationMsTotal: 0,
  httpByStatus: new Map<string, number>(),
  httpByRoute: new Map<string, number>(),
  wsUpgradeTotal: 0,
  wsConnectionsCurrent: 0,
  wsConnectionsTotal: 0,
  wsMessagesInTotal: 0,
  wsMessagesOutTotal: 0,
  wsMessagesInByType: new Map<string, number>(),
  wsMessagesOutByType: new Map<string, number>(),
  wsRateLimitedTotal: 0,
  wsInvalidJsonTotal: 0,
  wsInvalidEnvelopeTotal: 0,
  securityEvents: new Map<string, number>()
};

export function observeHttpRequest(input: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}): void {
  state.httpTotal += 1;
  state.httpDurationMsTotal += input.durationMs;
  if (input.statusCode >= 500) {
    state.httpErrorsTotal += 1;
  }
  increment(state.httpByStatus, String(input.statusCode));
  increment(state.httpByRoute, `${input.method} ${input.path}`);
}

export function observeWsUpgrade(): void {
  state.wsUpgradeTotal += 1;
}

export function observeWsConnectionOpen(): void {
  state.wsConnectionsCurrent += 1;
  state.wsConnectionsTotal += 1;
}

export function observeWsConnectionClose(): void {
  state.wsConnectionsCurrent = Math.max(0, state.wsConnectionsCurrent - 1);
}

export function observeWsMessageIn(type?: string): void {
  state.wsMessagesInTotal += 1;
  increment(state.wsMessagesInByType, type ?? "__raw__");
}

export function observeWsMessageInType(type: string): void {
  increment(state.wsMessagesInByType, type);
}

export function observeWsMessageOut(type: string): void {
  state.wsMessagesOutTotal += 1;
  increment(state.wsMessagesOutByType, type);
}

export function observeWsRateLimited(): void {
  state.wsRateLimitedTotal += 1;
}

export function observeWsInvalidJson(): void {
  state.wsInvalidJsonTotal += 1;
}

export function observeWsInvalidEnvelope(): void {
  state.wsInvalidEnvelopeTotal += 1;
}

export function observeSecurityEvent(name: string): void {
  increment(state.securityEvents, name);
}

export function snapshotMetrics() {
  const uptimeSec = Math.floor((Date.now() - state.startedAt) / 1000);
  const httpAvgDurationMs = state.httpTotal > 0 ? state.httpDurationMsTotal / state.httpTotal : 0;

  return {
    startedAt: state.startedAt,
    uptimeSec,
    http: {
      total: state.httpTotal,
      errorsTotal: state.httpErrorsTotal,
      avgDurationMs: Number(httpAvgDurationMs.toFixed(2)),
      byStatus: mapToObject(state.httpByStatus),
      byRoute: mapToObject(state.httpByRoute)
    },
    ws: {
      upgradeTotal: state.wsUpgradeTotal,
      connectionsCurrent: state.wsConnectionsCurrent,
      connectionsTotal: state.wsConnectionsTotal,
      messagesInTotal: state.wsMessagesInTotal,
      messagesOutTotal: state.wsMessagesOutTotal,
      messagesInByType: mapToObject(state.wsMessagesInByType),
      messagesOutByType: mapToObject(state.wsMessagesOutByType),
      rateLimitedTotal: state.wsRateLimitedTotal,
      invalidJsonTotal: state.wsInvalidJsonTotal,
      invalidEnvelopeTotal: state.wsInvalidEnvelopeTotal
    },
    security: {
      events: mapToObject(state.securityEvents)
    }
  };
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];
  const uptimeSec = Math.floor((Date.now() - state.startedAt) / 1000);
  const httpAvgDurationMs = state.httpTotal > 0 ? state.httpDurationMsTotal / state.httpTotal : 0;

  lines.push("# HELP bunrelay_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE bunrelay_uptime_seconds gauge");
  pushMetric(lines, "bunrelay_uptime_seconds", uptimeSec);

  lines.push("# HELP bunrelay_http_requests_total Total HTTP requests");
  lines.push("# TYPE bunrelay_http_requests_total counter");
  pushMetric(lines, "bunrelay_http_requests_total", state.httpTotal);

  lines.push("# HELP bunrelay_http_requests_by_status_total Total HTTP requests by status");
  lines.push("# TYPE bunrelay_http_requests_by_status_total counter");
  for (const [status, count] of state.httpByStatus.entries()) {
    pushMetric(lines, "bunrelay_http_requests_by_status_total", count, { status });
  }

  lines.push("# HELP bunrelay_http_requests_by_route_total Total HTTP requests by method/path");
  lines.push("# TYPE bunrelay_http_requests_by_route_total counter");
  for (const [route, count] of state.httpByRoute.entries()) {
    const firstSpace = route.indexOf(" ");
    const method = firstSpace >= 0 ? route.slice(0, firstSpace) : "__unknown__";
    const path = firstSpace >= 0 ? route.slice(firstSpace + 1) : route;
    pushMetric(lines, "bunrelay_http_requests_by_route_total", count, { method, path });
  }

  lines.push("# HELP bunrelay_http_request_duration_avg_ms Average HTTP request duration in ms");
  lines.push("# TYPE bunrelay_http_request_duration_avg_ms gauge");
  pushMetric(lines, "bunrelay_http_request_duration_avg_ms", Number(httpAvgDurationMs.toFixed(2)));

  lines.push("# HELP bunrelay_http_errors_total Total HTTP 5xx responses");
  lines.push("# TYPE bunrelay_http_errors_total counter");
  pushMetric(lines, "bunrelay_http_errors_total", state.httpErrorsTotal);

  lines.push("# HELP bunrelay_ws_upgrades_total Total WS upgrade requests");
  lines.push("# TYPE bunrelay_ws_upgrades_total counter");
  pushMetric(lines, "bunrelay_ws_upgrades_total", state.wsUpgradeTotal);

  lines.push("# HELP bunrelay_ws_connections_current Current open WS connections");
  lines.push("# TYPE bunrelay_ws_connections_current gauge");
  pushMetric(lines, "bunrelay_ws_connections_current", state.wsConnectionsCurrent);

  lines.push("# HELP bunrelay_ws_connections_total Total WS connections opened");
  lines.push("# TYPE bunrelay_ws_connections_total counter");
  pushMetric(lines, "bunrelay_ws_connections_total", state.wsConnectionsTotal);

  lines.push("# HELP bunrelay_ws_messages_in_total Total WS inbound messages");
  lines.push("# TYPE bunrelay_ws_messages_in_total counter");
  pushMetric(lines, "bunrelay_ws_messages_in_total", state.wsMessagesInTotal);

  lines.push("# HELP bunrelay_ws_messages_in_by_type_total Total WS inbound messages by type");
  lines.push("# TYPE bunrelay_ws_messages_in_by_type_total counter");
  for (const [type, count] of state.wsMessagesInByType.entries()) {
    pushMetric(lines, "bunrelay_ws_messages_in_by_type_total", count, { type });
  }

  lines.push("# HELP bunrelay_ws_messages_out_total Total WS outbound messages");
  lines.push("# TYPE bunrelay_ws_messages_out_total counter");
  pushMetric(lines, "bunrelay_ws_messages_out_total", state.wsMessagesOutTotal);

  lines.push("# HELP bunrelay_ws_messages_out_by_type_total Total WS outbound messages by type");
  lines.push("# TYPE bunrelay_ws_messages_out_by_type_total counter");
  for (const [type, count] of state.wsMessagesOutByType.entries()) {
    pushMetric(lines, "bunrelay_ws_messages_out_by_type_total", count, { type });
  }

  lines.push("# HELP bunrelay_ws_rate_limited_total Total WS events rejected by rate limit");
  lines.push("# TYPE bunrelay_ws_rate_limited_total counter");
  pushMetric(lines, "bunrelay_ws_rate_limited_total", state.wsRateLimitedTotal);

  lines.push("# HELP bunrelay_ws_invalid_json_total Total invalid WS JSON payloads");
  lines.push("# TYPE bunrelay_ws_invalid_json_total counter");
  pushMetric(lines, "bunrelay_ws_invalid_json_total", state.wsInvalidJsonTotal);

  lines.push("# HELP bunrelay_ws_invalid_envelope_total Total invalid WS envelopes");
  lines.push("# TYPE bunrelay_ws_invalid_envelope_total counter");
  pushMetric(lines, "bunrelay_ws_invalid_envelope_total", state.wsInvalidEnvelopeTotal);

  lines.push("# HELP bunrelay_security_events_total Total security-sensitive events");
  lines.push("# TYPE bunrelay_security_events_total counter");
  for (const [event, count] of state.securityEvents.entries()) {
    pushMetric(lines, "bunrelay_security_events_total", count, { event });
  }

  lines.push("");
  return lines.join("\n");
}
