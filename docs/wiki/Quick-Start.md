# Quick Start

## SQLite mode

Use this path when you want the fastest local setup.

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/health`
- `http://localhost:3000/ops/metrics`
- `http://localhost:3000/ops/metrics.prom`

## Seed accounts

- `alice`
- `bob`
- `carlos`
- `diana`
- `erin`

Password for all seeded users: `password123`

## Docker mode

Use this path when you want a more realistic local environment with Postgres and Redis.

```bash
docker compose up --build
```

## First flows to try

1. Log in with two seeded users in separate windows.
2. Join a room and exchange messages.
3. Create a group and change members or roles.
4. Inspect `GET /ops/metrics` while interacting with the app.

## If something fails

- Confirm Bun is installed.
- Check the server logs in the terminal.
- Verify whether you are using SQLite mode or Docker mode.
- Review `docs/api.md` for request and protocol expectations.
