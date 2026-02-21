import type { ServerSocket } from "./types.ts";

const byUser = new Map<string, Map<string, ServerSocket>>();

export function registerConnection(userId: string, deviceId: string, socket: ServerSocket): void {
  const byDevice = byUser.get(userId) ?? new Map<string, ServerSocket>();
  const existing = byDevice.get(deviceId);

  if (existing && existing !== socket) {
    existing.close(4000, "replaced by newer connection");
  }

  byDevice.set(deviceId, socket);
  byUser.set(userId, byDevice);
}

export function removeConnection(userId?: string, deviceId?: string, socket?: ServerSocket): void {
  if (!userId || !deviceId) {
    return;
  }

  const byDevice = byUser.get(userId);
  if (!byDevice) {
    return;
  }

  const current = byDevice.get(deviceId);
  if (!current) {
    return;
  }

  if (socket && current !== socket) {
    return;
  }

  byDevice.delete(deviceId);
  if (byDevice.size === 0) {
    byUser.delete(userId);
  }
}

export function hasAnyConnection(userId: string): boolean {
  const byDevice = byUser.get(userId);
  return Boolean(byDevice && byDevice.size > 0);
}

export function socketsForUser(userId: string): ServerSocket[] {
  const byDevice = byUser.get(userId);
  if (!byDevice) {
    return [];
  }
  return Array.from(byDevice.values());
}

export function socketsForUsers(userIds: string[]): ServerSocket[] {
  const sockets: ServerSocket[] = [];
  for (const userId of userIds) {
    sockets.push(...socketsForUser(userId));
  }
  return sockets;
}

export function allSockets(): ServerSocket[] {
  const sockets: ServerSocket[] = [];
  for (const byDevice of byUser.values()) {
    sockets.push(...byDevice.values());
  }
  return sockets;
}
