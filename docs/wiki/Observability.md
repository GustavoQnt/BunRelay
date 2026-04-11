# Observability

## Built-in signals

BunRelay includes a practical observability baseline:

- structured JSON logs
- `x-request-id` request correlation
- HTTP metrics
- WebSocket metrics
- security event counters
- optional tracing and external log sinks

## Endpoints

- `GET /health`
- `GET /ops/metrics`
- `GET /ops/metrics.prom`

## Tracing

Tracing is optional and controlled through environment variables such as:

- `TRACING_ENABLED`
- `TRACING_OTLP_HTTP_URL`
- `TRACING_SERVICE_NAME`

## Log sinks

External HTTP log fanout can be configured with:

- `LOG_SINK_HTTP_URLS`
- `LOG_SINK_HTTP_HEADERS`

## Why this matters in a template

Many chat boilerplates stop at message delivery. BunRelay includes enough observability to make debugging, demos, and production hardening more realistic.
