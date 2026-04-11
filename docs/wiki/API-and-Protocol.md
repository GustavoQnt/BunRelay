# API and Protocol

The detailed integration reference lives in `docs/api.md`.

## REST surface

BunRelay includes REST endpoints for:

- authentication
- refresh token rotation
- room listing and message history
- DM and group creation
- room member management
- room audit access
- health and metrics

## WebSocket surface

The WebSocket protocol handles:

- `auth:hello`
- `room:join`
- `msg:send`
- `msg:delivered`
- `msg:read`
- `typing:set`
- `presence:ping`

## Protocol philosophy

- Shared contracts live in `packages/shared`.
- Input validation is explicit.
- The wire format is intended to be easy to inspect and easy to extend.
- Defensive limits are part of the protocol design, not an afterthought.

## Recommended next step

Read `docs/api.md` when integrating a client or when adding new routes or events.
