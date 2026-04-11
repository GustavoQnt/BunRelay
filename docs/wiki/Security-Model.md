# Security Model

## Core protections

- JWT access tokens with session identity
- Opaque refresh tokens stored as hashes
- Refresh rotation with replay detection
- Login rate limiting
- WebSocket auth timeout
- WebSocket heartbeat timeout
- Per-connection event throttling
- Payload size limits
- Strict validation through shared schemas

## Authorization model

Room governance includes role-aware behavior for:

- members
- admins
- owners

Ownership transfer and owner protection flows are part of the model.

## Auditability

Room governance mutations are written to an audit trail so role and membership changes can be inspected later.

## Limits of the template

- Seed users are for local development only.
- Default secrets are not meant for production use.
- TLS termination and infrastructure hardening are deployment concerns outside the repository.
