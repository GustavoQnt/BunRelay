import { allSockets } from "./connections.ts";
import { sendEvent } from "./events.ts";
import type { ServerSocket } from "./types.ts";
import type { PresenceState } from "../services/presence.ts";
import { getPresenceStates } from "../services/presence.ts";

type BroadcastOptions = {
  excludeConnectionId?: string;
};

function hasAnyJoinedRoom(socket: ServerSocket, roomIds: Set<string>): boolean {
  for (const roomId of socket.data.joinedRooms) {
    if (roomIds.has(roomId)) {
      return true;
    }
  }
  return false;
}

export function broadcastPresenceToJoinedRoom(
  roomId: string,
  presence: PresenceState,
  options?: BroadcastOptions
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
}

export function broadcastPresenceToJoinedRooms(
  roomIds: Iterable<string>,
  presence: PresenceState,
  options?: BroadcastOptions
): void {
  const roomSet = new Set(roomIds);
  if (roomSet.size === 0) {
    return;
  }

  for (const socket of allSockets()) {
    if (options?.excludeConnectionId && socket.data.connectionId === options.excludeConnectionId) {
      continue;
    }
    if (!hasAnyJoinedRoom(socket, roomSet)) {
      continue;
    }
    sendEvent(socket, "presence:update", presence);
  }
}

export async function sendPresenceSnapshotForMembers(socket: ServerSocket, memberUserIds: string[]): Promise<void> {
  const states = await getPresenceStates(memberUserIds);
  for (const state of states) {
    sendEvent(socket, "presence:update", state);
  }
}

