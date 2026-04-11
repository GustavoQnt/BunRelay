# Deployment

## Local development

For local development, SQLite is the default and requires no external services.

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

## Production-like local environment

For a more realistic stack, use Docker Compose:

```bash
docker compose up --build
```

This brings up:

- Postgres
- Redis
- the Bun server

## Container image

BunRelay publishes a container image to:

- `ghcr.io/GustavoQnt/bunrelay`

## Deployment notes

- Use Postgres for non-trivial deployments.
- Configure a strong `JWT_SECRET`.
- Enable Redis when running multiple server instances.
- Review environment variables before public exposure.
- Put TLS and secret management in front of the service in real deployments.

## CI/CD

The repository includes workflows for CI, CD, and optional SonarQube scanning under `.github/workflows/`.
