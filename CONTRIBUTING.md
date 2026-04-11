# Contributing to BunRelay

Thanks for considering a contribution to BunRelay.

BunRelay is maintained as an open source realtime chat template for learning, experimentation, and reuse. Contributions are welcome when they keep the project focused, understandable, and easy to run.

## Before You Open a PR

- Check whether the change fits the template positioning of the project.
- Prefer scoped improvements over large product expansions.
- Open an issue first for significant architectural or behavior changes.
- Keep the demo UI simple unless the improvement clearly benefits onboarding or verification.

## Good Contribution Areas

- Documentation improvements
- Fixes to auth, room, or protocol behavior
- Better local setup and onboarding
- Test coverage for critical flows
- Observability, resilience, and deployment improvements
- Narrow template-friendly enhancements

## Usually Out of Scope

- Turning BunRelay into a full product UI
- Large frontend framework migrations
- Highly specific business logic
- Feature creep that makes the template harder to understand

## Local Setup

### Prerequisites

- Bun
- Docker Desktop if you want the Postgres and Redis path

### Run locally with SQLite

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

### Run locally with Docker

```bash
docker compose up --build
```

## Verification

Run the checks relevant to your change before opening a PR.

```bash
bun run typecheck
bun run test
```

Optional smoke flow:

```bash
bun run test:ui-smoke
```

## Pull Request Guidelines

- Keep PRs focused and reviewable.
- Update documentation when behavior, setup, or architecture changes.
- Add or update tests when the change affects critical behavior.
- Do not mix unrelated refactors with the main change.
- Explain the problem and the reason for the change, not just the code diff.

## Commit Style

There is no strict conventional commit requirement, but concise and descriptive messages are preferred. Use messages that explain intent, such as:

- `docs: reposition BunRelay as open source template`
- `fix: tighten ws auth timeout handling`
- `test: cover refresh token replay detection`

## Reporting Issues

Please use the issue templates when possible and include:

- What you expected
- What happened instead
- How to reproduce it
- Environment details

## Security Issues

Do not open a public issue for sensitive vulnerabilities. Follow `SECURITY.md` instead.
