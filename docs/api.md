# BunRelay API Reference

This document provides a practical integration guide for BunRelay REST and WebSocket APIs.

## Base URLs

- HTTP: `http://localhost:3000`
- WS: `ws://localhost:3000/ws`

## Content Types and Auth

- REST requests use `application/json`.
- Protected REST endpoints require `Authorization: Bearer <accessToken>`.
- WS authentication is event-based (`auth:hello`) after connecting to `/ws`.
- Optional incoming correlation headers: `x-request-id` (echoed back) and `traceparent` (W3C trace context).

## Seed Data (default local)

Users:

- `alice`
- `bob`
- `carlos`
- `diana`
- `erin`

Password for all: `password123`

Rooms seeded:

- `room_general`
- `room_random`
- `room_alice_bob`

## REST Endpoints

### Health

`GET /health`

Response:

```json
{
  "ok": true,
  "ts": 1730000000000
}
```

Response headers include:

- `x-request-id`
- `traceparent` (when tracing is enabled)

### Login

`POST /auth/login`

Request:

```json
{
  "username": "alice",
  "password": "password123",
  "deviceId": "web"
}
```

Response:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>",
  "user": {
    "id": "user_alice",
    "username": "alice",
    "displayName": "Alice"
  },
  "deviceId": "web"
}
```

Notes:

- Username/password are validated with shared Zod schemas.
- Login attempts are rate-limited by `IP + username`.

### Refresh Access Token

`POST /auth/refresh`

Request:

```json
{
  "refreshToken": "<opaque>"
}
```

Response:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<newOpaqueToken>"
}
```

Notes:

- Refresh tokens rotate on each successful call.
- Replay of an already-rotated refresh token revokes the session.

### List Rooms (Authenticated)

`GET /rooms`

Headers:

```text
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "rooms": [
    { "id": "room_general", "name": "General", "type": "group" },
    { "id": "room_random", "name": "Random", "type": "group" }
  ]
}
```

### Get Room Messages (Authenticated)

`GET /rooms/:roomId/messages`

Optional cursor query params:

- `cursorTs`
- `cursorMsgId`

Cursor example:

```text
GET /rooms/room_general/messages?cursorTs=1730000000000&cursorMsgId=msg_001
```

Response:

```json
{
  "roomId": "room_general",
  "messages": [
    {
      "roomId": "room_general",
      "messageId": "msg_001",
      "senderId": "user_alice",
      "content": "hello",
      "ts": 1730000000000
    }
  ],
  "cursor": {
    "ts": 1730000000000,
    "messageId": "msg_001"
  }
}
```

### Create or Get DM Room (Authenticated)

`POST /rooms/dm`

Request:

```json
{
  "peerUserId": "user_bob"
}
```

Responses:

- `201` when a DM is created
- `200` when the DM already exists (idempotent)

Body:

```json
{
  "room": {
    "id": "room_dm_user_alice_user_bob",
    "name": null,
    "type": "dm"
  },
  "created": true
}
```

### Create Group Room (Authenticated)

`POST /rooms/groups`

Request:

```json
{
  "name": "Project Ops",
  "memberIds": ["user_bob", "user_carlos"]
}
```

Notes:

- Creator is always included automatically in the group.
- Creator role is `owner`; other members are `member`.
- `memberIds` are deduplicated server-side.

Response (`201`):

```json
{
  "room": {
    "id": "room_group_u82ksp7k3p9f",
    "name": "Project Ops",
    "type": "group"
  },
  "memberIds": ["user_alice", "user_bob", "user_carlos"],
  "created": true
}
```

### Add Group Member (Authenticated)

`POST /rooms/:roomId/members`

Request:

```json
{
  "userId": "user_diana"
}
```

Notes:

- Room `owner` or `admin` can add members.
- Only `group` rooms support membership management.
- Idempotent: returns `200` with `added: false` if user is already a member.
- Successful changes emit WS `room:member:update` to online room participants.

Responses:

- `201` when member is added
- `200` when member already exists

Body:

```json
{
  "roomId": "room_group_u82ksp7k3p9f",
  "userId": "user_diana",
  "added": true
}
```

### Remove Group Member (Authenticated)

`DELETE /rooms/:roomId/members/:userId`

Notes:

- Room `owner` or `admin` can remove members.
- Only `group` rooms support membership management.
- The last admin cannot be removed.
- The room owner cannot be removed.
- Idempotent: returns `200` with `removed: false` when target user is not a member.
- Successful changes emit WS `room:member:update` to online room participants (including removed user).

Body:

```json
{
  "roomId": "room_group_u82ksp7k3p9f",
  "userId": "user_diana",
  "removed": true
}
```

### Update Group Member Role (Authenticated)

`PATCH /rooms/:roomId/members/:userId/role`

Request:

```json
{
  "role": "admin"
}
```

Notes:

- Room `owner` or `admin` can change roles.
- Only `group` rooms support membership management.
- Cannot demote the last admin.
- Owner role cannot be changed through this endpoint.
- Idempotent: returns `200` with `changed: false` when role is already the same.
- Successful changes emit WS `room:member:update` to online room participants.

Body:

```json
{
  "roomId": "room_group_u82ksp7k3p9f",
  "userId": "user_bob",
  "role": "admin",
  "changed": true
}
```

### Transfer Group Ownership (Authenticated)

`PATCH /rooms/:roomId/owner`

Request:

```json
{
  "userId": "user_bob"
}
```

Notes:

- Only current `owner` can transfer ownership.
- Target user must already be a member of the room.
- Only `group` rooms support ownership transfer.
- On success, previous owner becomes `admin`.
- Successful changes emit WS `room:member:update` with action `owner_transferred`.

Body:

```json
{
  "roomId": "room_group_u82ksp7k3p9f",
  "previousOwner": "user_alice",
  "newOwner": "user_bob"
}
```

### Room Audit Log (Authenticated)

`GET /rooms/:roomId/audit?limit=50&offset=0`

Notes:

- Room `owner` or `admin` can read audit entries.
- Default: `limit=50`, `offset=0`.
- `limit` max is `100`.

Response:

```json
{
  "roomId": "room_group_u82ksp7k3p9f",
  "entries": [
    {
      "id": "audit_x7abc1234def",
      "roomId": "room_group_u82ksp7k3p9f",
      "actorUserId": "user_alice",
      "action": "owner_transferred",
      "targetUserId": "user_bob",
      "metadata": null,
      "ts": 1730000000900
    }
  ]
}
```

## Metrics Endpoints

### JSON snapshot

`GET /ops/metrics`

Includes:

- HTTP totals/status/avg latency/route counters
- WS upgrades/connections/messages/errors/rate-limit counters
- security event counters

### Prometheus exposition

`GET /ops/metrics.prom`

Content type:

```text
text/plain; version=0.0.4; charset=utf-8
```

## REST Error Model

Most errors follow:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "invalid payload"
  }
}
```

Common codes:

- `UNAUTHORIZED`
- `BAD_REQUEST`
- `FORBIDDEN`
- `NOT_FOUND`
- `RATE_LIMITED`
- `BAD_STATE`
- `INTERNAL`

## WebSocket Protocol

All messages use an envelope:

```json
{
  "type": "msg:send",
  "id": "evt_123",
  "ts": 1730000000000,
  "data": {}
}
```

### Client -> Server events

- `auth:hello`
- `room:join`
- `msg:send`
- `msg:delivered`
- `msg:read`
- `typing:set`
- `presence:ping`

### Server -> Client events

- `auth:ok`
- `auth:error`
- `room:snapshot`
- `msg:ack_server`
- `msg:new`
- `msg:delivered`
- `msg:read`
- `typing:update`
- `room:member:update`
- `presence:update`
- `error`

## WS Authentication Flow

1. Connect to `ws://localhost:3000/ws`.
2. Send `auth:hello` with a valid access token and `deviceId`.
3. Wait for `auth:ok`.
4. Join at least one room with `room:join`.
5. Start sending message/read/delivery/typing events.
6. Keep connection alive using `presence:ping`.

Example `auth:hello`:

```json
{
  "type": "auth:hello",
  "id": "evt_auth_1",
  "ts": 1730000000000,
  "data": {
    "token": "<accessToken>",
    "deviceId": "web-chrome"
  }
}
```

Successful response:

```json
{
  "type": "auth:ok",
  "id": "srv_1",
  "ts": 1730000000100,
  "data": {
    "userId": "user_alice",
    "deviceId": "web-chrome",
    "expiresAt": 1730000900000
  }
}
```

## WS Room and Messaging Flow

Join:

```json
{
  "type": "room:join",
  "id": "evt_join_1",
  "ts": 1730000000200,
  "data": {
    "roomId": "room_general"
  }
}
```

Send message:

```json
{
  "type": "msg:send",
  "id": "evt_send_1",
  "ts": 1730000000300,
  "data": {
    "roomId": "room_general",
    "messageId": "msg_client_001",
    "content": "Hello world"
  }
}
```

Expected server sequence:

- `msg:ack_server` (persist acknowledged)
- `msg:new` (fanout to room participants)

Mark delivery:

```json
{
  "type": "msg:delivered",
  "id": "evt_delivered_1",
  "ts": 1730000000400,
  "data": {
    "roomId": "room_general",
    "messageId": "msg_client_001"
  }
}
```

Mark read:

```json
{
  "type": "msg:read",
  "id": "evt_read_1",
  "ts": 1730000000500,
  "data": {
    "roomId": "room_general",
    "cursor": {
      "ts": 1730000000300,
      "messageId": "msg_client_001"
    }
  }
}
```

Typing update:

```json
{
  "type": "typing:set",
  "id": "evt_typing_1",
  "ts": 1730000000600,
  "data": {
    "roomId": "room_general",
    "isTyping": true
  }
}
```

Heartbeat ping:

```json
{
  "type": "presence:ping",
  "id": "evt_ping_1",
  "ts": 1730000000700,
  "data": {}
}
```

Room membership update push (server -> client):

```json
{
  "type": "room:member:update",
  "id": "evt_membership_1",
  "ts": 1730000000800,
  "data": {
    "roomId": "room_general",
    "userId": "user_bob",
    "action": "owner_transferred",
    "role": "owner",
    "actorUserId": "user_alice"
  }
}
```

`room:member:update` actions:

- `added`
- `removed`
- `role_updated`
- `owner_transferred`

## Operational Limits and Defaults

- REST max body bytes: `HTTP_MAX_BODY_BYTES` (default `16384`)
- WS max frame bytes: `WS_MAX_MESSAGE_BYTES` (default `16384`)
- WS rate limit: `WS_RATE_LIMIT_PER_SEC` (default `50`)
- WS auth timeout: `WS_AUTH_TIMEOUT_MS` (default `5000`)
- WS heartbeat timeout: `WS_HEARTBEAT_TIMEOUT_MS` (default `45000`)
- Max message chars: `MESSAGE_MAX_CHARS` (default `4000`)

## Multi-Instance Delivery (Optional)

- Set `REDIS_URL` to enable Redis Pub/Sub fanout.
- Without `REDIS_URL`, server runs in local-only delivery mode.
- WS room and presence broadcasts are propagated across instances when Redis is enabled.

## Advanced Observability Integrations

### Distributed tracing backend (OTLP/HTTP)

Enable:

- `TRACING_ENABLED=true`
- `TRACING_OTLP_HTTP_URL=http://localhost:4318/v1/traces`

Optional:

- `TRACING_OTLP_HEADERS=Authorization=Bearer <token>`
- `TRACING_SAMPLING_RATIO=1`
- `TRACING_EXPORT_BATCH_SIZE=64`
- `TRACING_EXPORT_INTERVAL_MS=5000`
- `TRACING_EXPORT_TIMEOUT_MS=2500`

Behavior:

- HTTP requests create server spans.
- WS lifecycle/events create spans tied to connection context.
- W3C `traceparent` is accepted on inbound HTTP and propagated on outbound HTTP responses.
- Export is best-effort and non-blocking (app keeps running if backend is unavailable).

### External log sinks

Enable:

- `LOG_SINK_HTTP_URLS=https://logs.example.com/ingest`

Optional:

- `LOG_SINK_HTTP_HEADERS=Authorization=Bearer <token>`
- `LOG_SINK_BATCH_SIZE=100`
- `LOG_SINK_FLUSH_INTERVAL_MS=2000`
- `LOG_SINK_TIMEOUT_MS=2500`
- `LOG_SINK_BUFFER_MAX=2000`

Behavior:

- Logs continue to stdout/stderr as primary sink.
- Same structured records are also queued and pushed to configured external HTTP sinks.
- Delivery is best-effort, batched and asynchronous.

## End-to-End Curl Example

### 1) login

```bash
curl -s http://localhost:3000/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"password123","deviceId":"cli"}'
```

### 2) list rooms

```bash
curl -s http://localhost:3000/rooms \
  -H "authorization: Bearer <accessToken>"
```

### 3) fetch metrics

```bash
curl -s http://localhost:3000/ops/metrics
```

## Manual WS Test (wscat)

Connect:

```bash
npx wscat -c ws://localhost:3000/ws
```

Then send `auth:hello`:

```json
{"type":"auth:hello","id":"evt1","ts":1730000000000,"data":{"token":"<accessToken>","deviceId":"wscat"}}
```

Join a room:

```json
{"type":"room:join","id":"evt2","ts":1730000000100,"data":{"roomId":"room_general"}}
```

Send a message:

```json
{"type":"msg:send","id":"evt3","ts":1730000000200,"data":{"roomId":"room_general","messageId":"msg_wscat_1","content":"hello from wscat"}}
```

## Troubleshooting

- `401 UNAUTHORIZED` on `/rooms`: access token missing/expired/session revoked.
- `429 RATE_LIMITED` on login: too many attempts per minute for same `IP + username`.
- WS closes quickly after connect: `auth:hello` not sent in time or missing heartbeat.
- `BAD_REQUEST invalid event envelope`: WS payload does not match shared Zod schema.
