import { allSockets, socketsForUsers } from "./connections.ts";
import { sendEvent } from "./events.ts";
import { publish, isPubSubEnabled, subscribePattern, subscribe } from "../services/pubsub.ts";
import type { PubSubMessage } from "../services/pubsub.ts";
import { listRoomMemberIds } from "../services/room.ts";
import type { ServerSocket } from "./types.ts";
import type { PresenceState } from "../services/presence.ts";

export async function broadcastToRoom(
  roomId: string,
  eventType: string,
  data: unknown,
  memberIds?: string[]
): Promise<void> {
  const recipients = memberIds ?? (await listRoomMemberIds(roomId));

  // Local delivery
  for (const socket of socketsForUsers(recipients)) {
    sendEvent(socket, eventType, data);
  }

  // Publish to other nodes
  if (isPubSubEnabled()) {
    await publish(`bunrelay:room:${roomId}`, {
      type: eventType,
      data,
      roomId
    });
  }
}

export function broadcastPresenceToJoinedRoom(
  roomId: string,
  presence: PresenceState,
  options?: { excludeConnectionId?: string }
): void {
  for (const socket of allSockets()) {
    if (options?.excludeConnectionId && socket.data.connectionId === options.excludeConnectionId) {
      continue;
    }
    if (!socket.data.joinedRooms.has(roomId)) {
      continue;
    }
    sendEvent(socket, "presence:update", presence);
  }

  if (isPubSubEnabled()) {
    publish("bunrelay:presence", {
      type: "presence:update",
      data: presence,
      roomId,
      excludeConnectionId: options?.excludeConnectionId
    }).catch(() => {});
  }
}

export function broadcastPresenceToJoinedRooms(
  roomIds: Iterable<string>,
  presence: PresenceState,
  options?: { excludeConnectionId?: string }
): void {
  const roomSet = new Set(roomIds);
  if (roomSet.size === 0) {
    return;
  }

  for (const socket of allSockets()) {
    if (options?.excludeConnectionId && socket.data.connectionId === options.excludeConnectionId) {
      continue;
    }
    let hasRoom = false;
    for (const roomId of socket.data.joinedRooms) {
      if (roomSet.has(roomId)) {
        hasRoom = true;
        break;
      }
    }
    if (!hasRoom) continue;
    sendEvent(socket, "presence:update", presence);
  }

  if (isPubSubEnabled()) {
    for (const roomId of roomSet) {
      publish("bunrelay:presence", {
        type: "presence:update",
        data: presence,
        roomId,
        excludeConnectionId: options?.excludeConnectionId
      }).catch(() => {});
    }
  }
}

export async function broadcastRoomMemberUpdate(params: {
  roomId: string;
  userId: string;
  action: "added" | "removed" | "role_updated" | "owner_transferred";
  role?: "member" | "admin" | "owner";
  actorUserId: string;
  includeUserIds?: string[];
}): Promise<void> {
  const currentMemberIds = await listRoomMemberIds(params.roomId);
  const recipients = [...new Set([...currentMemberIds, ...(params.includeUserIds ?? [])])];

  const eventData = {
    roomId: params.roomId,
    userId: params.userId,
    action: params.action,
    role: params.role,
    actorUserId: params.actorUserId
  };

  for (const socket of socketsForUsers(recipients)) {
    sendEvent(socket, "room:member:update", eventData);
  }

  if (isPubSubEnabled()) {
    await publish(`bunrelay:room:${params.roomId}`, {
      type: "room:member:update",
      data: eventData,
      roomId: params.roomId
    });
  }
}

function handleRemoteRoomEvent(message: PubSubMessage): void {
  if (!message.roomId) return;

  // Deliver to all local sockets that have joined this room
  for (const socket of allSockets()) {
    if (!socket.data.joinedRooms.has(message.roomId)) continue;
    sendEvent(socket, message.type, message.data);
  }
}

function handleRemotePresenceEvent(message: PubSubMessage): void {
  for (const socket of allSockets()) {
    if (message.excludeConnectionId && socket.data.connectionId === message.excludeConnectionId) {
      continue;
    }
    if (message.roomId && !socket.data.joinedRooms.has(message.roomId)) {
      continue;
    }
    sendEvent(socket, "presence:update", message.data);
  }
}

export async function initBroadcastSubscriptions(): Promise<void> {
  if (!isPubSubEnabled()) return;

  await subscribePattern("bunrelay:room:*", handleRemoteRoomEvent);
  await subscribe("bunrelay:presence", handleRemotePresenceEvent);
}
