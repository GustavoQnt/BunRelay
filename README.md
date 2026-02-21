# BunRelay

[![CI](https://github.com/GustavoQnt/BunRelay/actions/workflows/ci.yml/badge.svg)](https://github.com/GustavoQnt/BunRelay/actions/workflows/ci.yml)
[![CD](https://github.com/GustavoQnt/BunRelay/actions/workflows/cd.yml/badge.svg)](https://github.com/GustavoQnt/BunRelay/actions/workflows/cd.yml)
[![SonarQube](https://github.com/GustavoQnt/BunRelay/actions/workflows/sonarqube.yml/badge.svg)](https://github.com/GustavoQnt/BunRelay/actions/workflows/sonarqube.yml)
[![GHCR](https://img.shields.io/badge/GHCR-ghcr.io%2FGustavoQnt%2Fbunrelay-2496ED?logo=docker&logoColor=white)](https://ghcr.io/GustavoQnt/bunrelay)
[![Runtime](https://img.shields.io/badge/runtime-bun-000000?logo=bun)](https://bun.sh/)

Production-oriented realtime chat template built with Bun + native WebSocket + Drizzle.

BunRelay is designed to be cloned and evolved into real products, not demo-only experiments:

- Native `Bun.serve()` for HTTP + WS in one process.
- Shared protocol contracts with Zod (`packages/shared`).
- SQLite-first local dev and Postgres-ready deployment mode.
- Auth stack with refresh token rotation + replay detection.
- Built-in observability baseline (structured logs, request IDs, metrics endpoints).

## Language

- [English](#english)
- [Portugues (PT-BR)](#portugues-pt-br)

## English

### Why BunRelay

- Fast startup path: run local with SQLite and no Docker.
- Clear migration path: switch to Postgres via environment variables.
- Typed protocol boundaries: server/client event schemas in one shared package.
- Practical security defaults: rate limits, payload caps, WS heartbeat/auth timeouts.
- Operational baseline included: metrics for HTTP/WS/security and JSON logs.

### Architecture

```text
Client (browser/mobile/backend)
  | REST (/auth/*, /rooms/*, /health, /ops/*)
  | WS   (/ws)
  v
Bun.serve() entrypoint (apps/server/src/index.ts)
  |-- REST routes (auth, rooms, health, metrics)
  |-- WS handler/router (auth, room join, messaging, delivery, read, typing, presence)
  |-- Services (message, room, presence, metrics)
  |-- Auth/JWT middleware + session checks
  v
Drizzle ORM
  |-- SQLite (default)
  '-- Postgres (DB_DRIVER=postgres)
```

### Tech Stack

| Area | Choice |
|---|---|
| Runtime | Bun |
| HTTP + WS | Native `Bun.serve()` |
| ORM | Drizzle ORM |
| Database | SQLite / Postgres |
| Validation | Zod |
| Auth | JWT (`jose`) + hashed opaque refresh tokens |
| Demo UI | Vanilla HTML/JS (`apps/server/public/index.html`) |

### Features Implemented

- `POST /auth/login` and `POST /auth/refresh`
- Refresh token rotation with reuse detection and session revocation
- WS event flow: auth, room join, send/receive, delivered, read, typing, heartbeat
- Message idempotency via client `messageId`
- Room-scoped presence and snapshots
- HTTP + WS limits and defensive validation
- Metrics endpoints: `GET /ops/metrics` (JSON) and `GET /ops/metrics.prom` (Prometheus format)
- GitHub Actions for CI/CD and optional SonarQube scanning

### Quickstart (SQLite mode)

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

### Docker Mode (Postgres)

```bash
docker compose up --build
```

The compose flow starts Postgres and server, then runs:

- `bun run db:migrate`
- `bun run db:seed`
- `bun run start`

### Environment Variables

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
| `JWT_SECRET` | `dev-secret-change-me-at-least-32-characters` | HS256 secret, use a strong one |
| `JWT_ACCESS_TTL_SEC` | `900` | access token TTL |
| `JWT_REFRESH_TTL_SEC` | `604800` | refresh/session TTL |
| `HTTP_MAX_BODY_BYTES` | `16384` | max REST JSON body size |
| `WS_MAX_MESSAGE_BYTES` | `16384` | max WS frame size |
| `WS_RATE_LIMIT_PER_SEC` | `50` | per-connection token bucket |
| `WS_AUTH_TIMEOUT_MS` | `5000` | max time before `auth:hello` |
| `WS_HEARTBEAT_TIMEOUT_MS` | `45000` | max silence before close |
| `MESSAGE_MAX_CHARS` | `4000` | max message content length |

### Scripts

| Script | Command | Purpose |
|---|---|---|
| `bun run dev` | `bun run --cwd apps/server dev` | run server with watch |
| `bun run start` | `bun run --cwd apps/server start` | run server without watch |
| `bun run db:migrate` | `bun run --cwd apps/server db:migrate` | apply migrations |
| `bun run db:seed` | `bun run --cwd apps/server db:seed` | load demo users/rooms |
| `bun run typecheck` | root + shared typecheck | static type validation |
| `bun run test` | `bun run --cwd apps/server test` | auth + e2e tests |
| `bun run ci` | `typecheck + test` | local CI equivalent |

### API and Protocol

Detailed reference moved to `docs/api.md`:

- REST endpoints and auth flow
- WS event contract and sequencing
- Error model and operational limits
- Ready-to-run curl examples and troubleshooting hints

### Security Model

- JWT access tokens (`HS256`) with user + session identity.
- Opaque refresh tokens stored as SHA-256 hashes.
- Refresh replay detection revokes session.
- Login rate limiting (`5/min` per IP + username outside tests).
- WS auth timeout + heartbeat timeout + per-connection event throttling.
- Payload size limits and strict Zod validation on REST and WS envelopes.

### Observability

- Structured JSON logs (`ts`, `level`, `event`, context fields).
- Automatic request correlation with `x-request-id`.
- HTTP counters: totals, status classes, route-level counters, avg latency.
- WS counters: upgrades, active connections, in/out by event type, invalid payloads.
- Security event counters exposed in JSON and Prometheus formats.

### CI/CD

- CI workflow: `.github/workflows/ci.yml`
- CD workflow: `.github/workflows/cd.yml`
- SonarQube workflow: `.github/workflows/sonarqube.yml` (runs only when required secrets/vars are present)
- Container publish target: `ghcr.io/GustavoQnt/bunrelay`

### Roadmap (current pending items)

- Advanced observability integrations (external tracing/log sinks)
- GitHub repo hardening (required checks, branch protection, environment secrets)
- Optional frontend productization (UX polish, reconnect/error states, accessibility QA)

## Portugues (PT-BR)

### Resumo

BunRelay e um template de chat em tempo real para acelerar times que querem sair rapido do prototipo e evoluir para algo operavel.

Pontos fortes:

- Backend Bun puro com HTTP + WebSocket no mesmo processo.
- Contratos compartilhados com Zod.
- Desenvolvimento local simples com SQLite.
- Modo Postgres pronto para ambiente mais realista.
- Auth com refresh rotativo e deteccao de reuso.
- Observabilidade baseline pronta (logs JSON + metricas).

### Inicio rapido

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

Endpoints uteis:

- `http://localhost:3000/health`
- `http://localhost:3000/ops/metrics`
- `http://localhost:3000/ops/metrics.prom`

Usuarios de seed: `alice`, `bob`, `carlos`, `diana`, `erin`

Senha: `password123`

### Docker + Postgres

```bash
docker compose up --build
```

### Variaveis de ambiente

Copie:

```powershell
Copy-Item .env.example .env
```

No minimo, altere `JWT_SECRET` para um valor forte fora de ambiente local.

### Documentacao tecnica completa

- API REST e protocolo WS: `docs/api.md`
- Plano tecnico/roadmap: `docs/plans/2026-02-20-bunrelay-design.md`
