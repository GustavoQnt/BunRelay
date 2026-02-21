import { and, eq, gt, isNull } from "drizzle-orm";

import type { ClientEvent } from "@bunrelay/shared";

import { verifyAccessToken } from "../auth/jwt.ts";
import { env } from "../config/env.ts";
import { db } from "../db/index.ts";
import { roomMembers, sessions } from "../db/schema.ts";
import { markDelivered, persistMessage, upsertReadCursor } from "../services/message.ts";
import { isUserOnline, markOnline } from "../services/presence.ts";
import { getRoomSnapshot, isRoomMember, roomExists } from "../services/room.ts";
import { setTyping } from "../services/typing.ts";
import { socketsForUsers } from "./connections.ts";
import { sendError, sendEvent } from "./events.ts";
import { broadcastPresenceToJoinedRoom, sendPresenceSnapshotForMembers } from "./presence.ts";
import type { ServerSocket } from "./types.ts";

type RouterContext = {
  onAuthenticated: (socket: ServerSocket) => void;
  resetHeartbeat: (socket: ServerSocket) => void;
};

async function roomMemberIds(roomId: string): Promise<string[]> {
  const members = await db
    .select({
      userId: roomMembers.userId
    })
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId));

  return members.map((member: any) => member.userId);
}

function requireAuth(socket: ServerSocket, refId: string): boolean {
  if (socket.data.authed) {
    return true;
  }
  sendError(socket, "BAD_STATE", "auth required", refId);
  return false;
}

function requireJoinedRoom(socket: ServerSocket, roomId: string, refId: string): boolean {
  if (socket.data.joinedRooms.has(roomId)) {
    return true;
  }
  sendError(socket, "BAD_STATE", "room must be joined first", refId);
  return false;
}

async function handleAuthHello(socket: ServerSocket, event: Extract<ClientEvent, { type: "auth:hello" }>, ctx: RouterContext) {
  if (socket.data.authed) {
    sendError(socket, "BAD_STATE", "already authenticated", event.id);
    return;
  }

  let claims: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    claims = await verifyAccessToken(event.data.token);
  } catch {
    sendEvent(socket, "auth:error", {
      code: "UNAUTHORIZED",
      message: "invalid or expired token"
    });
    return;
  }

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, claims.sid),
      eq(sessions.userId, claims.sub),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, Date.now())
    )
  });

  if (!session) {
    sendEvent(socket, "auth:error", {
      code: "UNAUTHORIZED",
      message: "session not active"
    });
    return;
  }

  socket.data.authed = true;
  socket.data.userId = claims.sub;
  socket.data.sessionId = session.id;
  socket.data.deviceId = event.data.deviceId;
  socket.data.joinedRooms.clear();

  const presence = await markOnline(claims.sub);

  sendEvent(socket, "auth:ok", {
    userId: claims.sub,
    deviceId: event.data.deviceId,
    expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + 15 * 60_000
  });

  if (presence) {
    sendEvent(socket, "presence:update", presence);
  }

  ctx.onAuthenticated(socket);
  ctx.resetHeartbeat(socket);
}

async function handleRoomJoin(socket: ServerSocket, event: Extract<ClientEvent, { type: "room:join" }>) {
  if (!requireAuth(socket, event.id)) {
    return;
  }

  const userId = socket.data.userId!;
  const exists = await roomExists(event.data.roomId);
  if (!exists) {
    sendError(socket, "NOT_FOUND", "room not found", event.id);
    return;
  }

  const member = await isRoomMember(userId, event.data.roomId);
  if (!member) {
    sendError(socket, "FORBIDDEN", "not a room member", event.id);
    return;
  }

  const alreadyJoined = socket.data.joinedRooms.has(event.data.roomId);
  socket.data.joinedRooms.add(event.data.roomId);
  const snapshot = await getRoomSnapshot(userId, event.data.roomId, event.data.cursor);
  sendEvent(socket, "room:snapshot", snapshot);
  await sendPresenceSnapshotForMembers(
    socket,
    snapshot.members.map((member: any) => member.userId)
  );

  if (!alreadyJoined && isUserOnline(userId)) {
    broadcastPresenceToJoinedRoom(
      event.data.roomId,
      {
        userId,
        status: "online",
        lastSeen: null
      },
      {
        excludeConnectionId: socket.data.connectionId
      }
    );
  }
}

async function handleMsgSend(socket: ServerSocket, event: Extract<ClientEvent, { type: "msg:send" }>) {
  if (!requireAuth(socket, event.id)) {
    return;
  }

  if (!requireJoinedRoom(socket, event.data.roomId, event.id)) {
    return;
  }

  if (event.data.content.length > env.MESSAGE_MAX_CHARS) {
    sendError(socket, "BAD_REQUEST", `message too long (max ${env.MESSAGE_MAX_CHARS} chars)`, event.id);
    return;
  }

  const persisted = await persistMessage({
    roomId: event.data.roomId,
    senderId: socket.data.userId!,
    messageId: event.data.messageId,
    content: event.data.content
  });

  sendEvent(socket, "msg:ack_server", { messageId: event.data.messageId });

  if (persisted.isNew) {
    const { isNew: _, ...msg } = persisted;
    const recipients = await roomMemberIds(event.data.roomId);
    for (const peer of socketsForUsers(recipients)) {
      sendEvent(peer, "msg:new", msg);
    }
  }
}

async function handleMsgDelivered(socket: ServerSocket, event: Extract<ClientEvent, { type: "msg:delivered" }>) {
  if (!requireAuth(socket, event.id)) {
    return;
  }

  if (!requireJoinedRoom(socket, event.data.roomId, event.id)) {
    return;
  }

  const userId = socket.data.userId!;
  const deviceId = socket.data.deviceId!;

  const delivered = await markDelivered({
    roomId: event.data.roomId,
    messageId: event.data.messageId,
    userId,
    deviceId
  });

  if (!delivered) {
    sendError(socket, "NOT_FOUND", "message not found for room", event.id);
    return;
  }

  const recipients = await roomMemberIds(event.data.roomId);
  for (const peer of socketsForUsers(recipients)) {
    sendEvent(peer, "msg:delivered", delivered);
  }
}

async function handleMsgRead(socket: ServerSocket, event: Extract<ClientEvent, { type: "msg:read" }>) {
  if (!requireAuth(socket, event.id)) {
    return;
  }

  if (!requireJoinedRoom(socket, event.data.roomId, event.id)) {
    return;
  }

  const readCursor = await upsertReadCursor({
    roomId: event.data.roomId,
    userId: socket.data.userId!,
    cursor: event.data.cursor
  });

  const recipients = await roomMemberIds(event.data.roomId);
  for (const peer of socketsForUsers(recipients)) {
    sendEvent(peer, "msg:read", readCursor);
  }
}

async function handleTypingSet(socket: ServerSocket, event: Extract<ClientEvent, { type: "typing:set" }>) {
  if (!requireAuth(socket, event.id)) {
    return;
  }

  if (!requireJoinedRoom(socket, event.data.roomId, event.id)) {
    return;
  }

  const update = setTyping(event.data.roomId, socket.data.userId!, event.data.isTyping);
  const recipients = await roomMemberIds(event.data.roomId);
  for (const peer of socketsForUsers(recipients)) {
    sendEvent(peer, "typing:update", update);
  }
}

function handlePresencePing(socket: ServerSocket, event: Extract<ClientEvent, { type: "presence:ping" }>, ctx: RouterContext) {
  if (!requireAuth(socket, event.id)) {
    return;
  }
  ctx.resetHeartbeat(socket);
}

export async function routeClientEvent(socket: ServerSocket, event: ClientEvent, ctx: RouterContext): Promise<void> {
  switch (event.type) {
    case "auth:hello":
      await handleAuthHello(socket, event, ctx);
      return;
    case "room:join":
      await handleRoomJoin(socket, event);
      return;
    case "msg:send":
      await handleMsgSend(socket, event);
      return;
    case "msg:delivered":
      await handleMsgDelivered(socket, event);
      return;
    case "msg:read":
      await handleMsgRead(socket, event);
      return;
    case "typing:set":
      await handleTypingSet(socket, event);
      return;
    case "presence:ping":
      handlePresencePing(socket, event, ctx);
      return;
    default:
      return;
  }
}
