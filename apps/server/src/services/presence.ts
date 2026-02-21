import { eq, inArray } from "drizzle-orm";

import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";

const onlineCounters = new Map<string, number>();

export type PresenceState = {
  userId: string;
  status: "online" | "offline";
  lastSeen: number | null;
};

function getCount(userId: string): number {
  return onlineCounters.get(userId) ?? 0;
}

export async function markOnline(userId: string) {
  const current = getCount(userId);
  onlineCounters.set(userId, current + 1);

  if (current === 0) {
    return {
      userId,
      status: "online" as const,
      lastSeen: null
    };
  }

  return null;
}

export async function markOffline(userId: string) {
  const current = getCount(userId);
  const next = Math.max(0, current - 1);

  if (next === 0) {
    onlineCounters.delete(userId);
    const lastSeen = Date.now();

    await db.update(users).set({ lastSeen }).where(eq(users.id, userId));

    return {
      userId,
      status: "offline" as const,
      lastSeen
    };
  }

  onlineCounters.set(userId, next);
  return null;
}

export function isUserOnline(userId: string): boolean {
  return getCount(userId) > 0;
}

export async function getPresenceStates(userIds: string[]): Promise<PresenceState[]> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: users.id,
      lastSeen: users.lastSeen
    })
    .from(users)
    .where(inArray(users.id, uniqueUserIds));

  const lastSeenByUser = new Map<string, number | null>(
    rows.map((row: any) => [String(row.id), row.lastSeen === null || row.lastSeen === undefined ? null : Number(row.lastSeen)])
  );

  return uniqueUserIds.map((userId) => {
    const online = isUserOnline(userId);
    return {
      userId,
      status: online ? "online" : "offline",
      lastSeen: online ? null : (lastSeenByUser.get(userId) ?? null)
    };
  });
}
