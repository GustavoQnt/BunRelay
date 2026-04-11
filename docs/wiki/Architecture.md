# Architecture

## Overview

BunRelay uses a single Bun server entrypoint for both HTTP and WebSocket traffic. The project favors a compact architecture that is easy to follow and easy to extend.

```text
Client
  | REST + WS
  v
Bun.serve()
  |-- routes
  |-- ws handlers
  |-- services
  |-- auth middleware
  v
Drizzle ORM
  |-- SQLite
  '-- Postgres
```

## Main layers

### HTTP routes

REST endpoints cover login, refresh, room management, health, and operational metrics.

### WebSocket layer

The WebSocket flow handles authentication, room joins, messaging, receipts, typing, presence, and heartbeats.

### Services

Business logic is separated into focused services such as message, room, presence, typing, audit, and pub/sub.

### Data layer

Drizzle provides a typed persistence layer with support for SQLite in local development and Postgres in a more production-like setup.

## Scaling model

- Single instance works without Redis.
- Multi-instance fanout becomes available when `REDIS_URL` is configured.
- Presence is room-scoped.
- Metrics and logs are built in from the start.

## Design trade-offs

- Minimal frontend complexity keeps the backend easier to evaluate.
- Native Bun APIs reduce framework layers but require clearer documentation.
- The architecture is optimized for understanding and reuse more than for maximal feature breadth.
