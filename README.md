# BunRelay

[![CI](https://github.com/GustavoQnt/BunRelay/actions/workflows/ci.yml/badge.svg)](https://github.com/GustavoQnt/BunRelay/actions/workflows/ci.yml)
[![CD](https://github.com/GustavoQnt/BunRelay/actions/workflows/cd.yml/badge.svg)](https://github.com/GustavoQnt/BunRelay/actions/workflows/cd.yml)
[![SonarQube](https://github.com/GustavoQnt/BunRelay/actions/workflows/sonarqube.yml/badge.svg)](https://github.com/GustavoQnt/BunRelay/actions/workflows/sonarqube.yml)
[![GHCR](https://img.shields.io/badge/GHCR-ghcr.io%2FGustavoQnt%2Fbunrelay-2496ED?logo=docker&logoColor=white)](https://ghcr.io/GustavoQnt/bunrelay)
[![Runtime](https://img.shields.io/badge/runtime-bun-000000?logo=bun)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

Open source realtime chat template built with Bun, native WebSocket, Drizzle, and practical production defaults.

BunRelay is intentionally positioned as a `clone-or-fork` starting point for developers who want a serious chat baseline without framework lock-in.

## Why BunRelay

- Native `Bun.serve()` handles HTTP and WebSocket in one process.
- Shared protocol contracts with Zod live in `packages/shared`.
- SQLite-first local setup keeps onboarding fast.
- Postgres and Redis paths are already prepared for more realistic deployments.
- Security and observability are built into the baseline, not bolted on later.

## Best For

- Learning how a realtime chat backend can be structured on Bun.
- Starting a new internal product or side project from a typed template.
- Portfolio and architecture study around auth, rooms, presence, fanout, and ops.
- Teams that want a minimal demo UI while keeping the backend serious.

## Not For

- Teams looking for a polished end-user chat product out of the box.
- Projects that want a batteries-included frontend framework or design system.
- A drop-in npm package to install into an existing app.

## What You Get

- `POST /auth/login` and `POST /auth/refresh`
- Refresh token rotation with replay detection and session revocation
- WebSocket auth, room join, send/receive, delivered, read, typing, and heartbeat flows
- Room creation and governance APIs for DMs and groups
- Room-scoped presence, membership sync, and audit trail
- Optional Redis Pub/Sub fanout for multi-instance realtime delivery
- Structured logs, request IDs, JSON metrics, and Prometheus metrics
- GitHub Actions workflows for CI/CD and optional SonarQube scanning

## Quickstart

### SQLite mode

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

Open:

- App: `http://localhost:3000`
- Health: `http://localhost:3000/health`
- Metrics JSON: `http://localhost:3000/ops/metrics`
- Metrics Prometheus: `http://localhost:3000/ops/metrics.prom`

Seed users:

- `alice`
- `bob`
- `carlos`
- `diana`
- `erin`

Password for all seeded users: `password123`

### Docker mode

```bash
docker compose up --build
```

This starts Postgres, Redis, and the server in a more production-like local environment.

## Try These Flows After Boot

1. Log in as `alice` and `bob` in separate browser windows.
2. Join the seeded DM and send a few messages to inspect delivery and read events.
3. Create a group, add a member, transfer ownership, and inspect the room audit endpoint.
4. Open `GET /ops/metrics` to see HTTP, WS, and security counters move in real time.

## Architecture

```text
Client (browser/mobile/backend)
  | REST (/auth/*, /rooms/*, /health, /ops/*)
  | WS   (/ws)
  v
Bun.serve() entrypoint (apps/server/src/index.ts)
  |-- REST routes (auth, rooms, health, metrics)
  |-- WS handler/router (auth, room join, messaging, delivery, read, typing, presence)
  |-- Services (message, room, presence, audit, pubsub)
  |-- Auth/JWT middleware + session checks
  v
Drizzle ORM
  |-- SQLite (default)
  '-- Postgres (DB_DRIVER=postgres)
  |
Pub/Sub layer (optional)
  |-- Redis channel fanout for multi-instance WS delivery
  '-- Local-only fallback when REDIS_URL is not set
```

## Tech Stack

| Area | Choice |
|---|---|
| Runtime | Bun |
| HTTP + WS | Native `Bun.serve()` |
| ORM | Drizzle ORM |
| Database | SQLite / Postgres |
| Validation | Zod |
| Auth | JWT (`jose`) + hashed opaque refresh tokens |
| Demo UI | Vanilla HTML/JS (`apps/server/public/index.html`) |

## Open Source Model

- Source of truth is the repository itself.
- Deep documentation is versioned under `docs/wiki/`.
- BunRelay is meant to be cloned, adapted, and learned from.
- The repository includes contribution, security, and collaboration guides for external contributors.

## Documentation Map

- API reference: `docs/api.md`
- Wiki index: `docs/wiki/README.md`
- Architecture deep dive: `docs/wiki/Architecture.md`
- Deployment guide: `docs/wiki/Deployment.md`
- Observability guide: `docs/wiki/Observability.md`
- Security model: `docs/wiki/Security-Model.md`
- Extension guide: `docs/wiki/Extending-BunRelay.md`
- Design and roadmap context: `docs/plans/2026-02-20-bunrelay-design.md`

## Environment Variables

Defaults live in `apps/server/src/config/env.ts`, so `.env` is optional for local runs.

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

| Variable | Default | Description |
|---|---:|---|
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `HOST` | `0.0.0.0` | server host |
| `PORT` | `3000` | HTTP/WS port |
| `DB_DRIVER` | `sqlite` | `sqlite` or `postgres` |
| `DB_URL` | `apps/server/data/dev.sqlite` | SQLite path or Postgres URL |
| `REDIS_URL` | _empty_ | optional Redis URL for multi-instance pub/sub |
| `JWT_SECRET` | `dev-secret-change-me-at-least-32-characters` | HS256 secret, use a strong one |
| `JWT_ACCESS_TTL_SEC` | `900` | access token TTL |
| `JWT_REFRESH_TTL_SEC` | `604800` | refresh/session TTL |
| `HTTP_MAX_BODY_BYTES` | `16384` | max REST JSON body size |
| `WS_MAX_MESSAGE_BYTES` | `16384` | max WS frame size |
| `WS_RATE_LIMIT_PER_SEC` | `50` | per-connection token bucket |
| `WS_AUTH_TIMEOUT_MS` | `5000` | max time before `auth:hello` |
| `WS_HEARTBEAT_TIMEOUT_MS` | `45000` | max silence before close |
| `MESSAGE_MAX_CHARS` | `4000` | max message content length |
| `TRACING_ENABLED` | `false` | enable tracing spans/context pipeline |
| `TRACING_SERVICE_NAME` | `bunrelay-server` | service name attached to exported spans/log sink batches |
| `TRACING_OTLP_HTTP_URL` | _empty_ | OTLP traces endpoint |
| `TRACING_OTLP_HEADERS` | _empty_ | custom OTLP headers (`key=value,key2=value2`) |
| `TRACING_SAMPLING_RATIO` | `1` | root span sampling ratio (`0..1`) |
| `TRACING_EXPORT_BATCH_SIZE` | `64` | max spans per export batch |
| `TRACING_EXPORT_INTERVAL_MS` | `5000` | periodic export flush interval |
| `TRACING_EXPORT_TIMEOUT_MS` | `2500` | OTLP export request timeout |
| `LOG_SINK_HTTP_URLS` | _empty_ | comma-separated external HTTP sink URLs |
| `LOG_SINK_HTTP_HEADERS` | _empty_ | headers for log sink requests (`key=value,key2=value2`) |
| `LOG_SINK_BATCH_SIZE` | `100` | max records per sink push |
| `LOG_SINK_FLUSH_INTERVAL_MS` | `2000` | periodic log sink flush interval |
| `LOG_SINK_TIMEOUT_MS` | `2500` | sink request timeout |
| `LOG_SINK_BUFFER_MAX` | `2000` | in-memory sink buffer cap per endpoint |

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `bun run dev` | `bun run --cwd apps/server dev` | run server with watch |
| `bun run start` | `bun run --cwd apps/server start` | run server without watch |
| `bun run db:migrate` | `bun run --cwd apps/server db:migrate` | apply migrations |
| `bun run db:seed` | `bun run --cwd apps/server db:seed` | load demo users/rooms |
| `bun run typecheck` | root + shared typecheck | static type validation |
| `bun run test` | `bun run --cwd apps/server test` | auth + e2e tests |
| `bun run test:ui-smoke` | `node scripts/ui-smoke.mjs` | browser smoke flow |
| `bun run ci` | `typecheck + test` | local CI equivalent |

## CI/CD

- CI workflow: `.github/workflows/ci.yml`
- CD workflow: `.github/workflows/cd.yml`
- SonarQube workflow: `.github/workflows/sonarqube.yml`
- Container publish target: `ghcr.io/GustavoQnt/bunrelay`

## Contributing and Governance

- Contributing guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- License: `LICENSE`

## PT-BR Resumo

BunRelay e um template open source de chat em tempo real feito para aprendizado, portfolio e reutilizacao como base de produto. O foco e mostrar uma arquitetura enxuta, tipada e operavel com Bun, WebSocket nativo, auth, salas, observabilidade e caminho realista para Postgres e Redis.

Se voce quer subir rapido, estudar a estrutura e depois adaptar para seu proprio caso, este repo foi feito para isso.
