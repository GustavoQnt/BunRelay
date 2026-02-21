# BunRelay API Reference

This document provides a practical integration guide for BunRelay REST and WebSocket APIs.

## Base URLs

- HTTP: `http://localhost:3000`
- WS: `ws://localhost:3000/ws`

## Content Types and Auth

- REST requests use `application/json`.
- Protected REST endpoints require `Authorization: Bearer <accessToken>`.
- WS authentication is event-based (`auth:hello`) after connecting to `/ws`.

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

## Operational Limits and Defaults

- REST max body bytes: `HTTP_MAX_BODY_BYTES` (default `16384`)
- WS max frame bytes: `WS_MAX_MESSAGE_BYTES` (default `16384`)
- WS rate limit: `WS_RATE_LIMIT_PER_SEC` (default `50`)
- WS auth timeout: `WS_AUTH_TIMEOUT_MS` (default `5000`)
- WS heartbeat timeout: `WS_HEARTBEAT_TIMEOUT_MS` (default `45000`)
- Max message chars: `MESSAGE_MAX_CHARS` (default `4000`)

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
