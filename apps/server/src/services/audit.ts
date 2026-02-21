import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";

import { db } from "../db/index.ts";
import { roomAuditLog } from "../db/schema.ts";

export type AuditAction = "added" | "removed" | "role_updated" | "owner_transferred" | "room_created";

export async function logAuditEvent(params: {
  roomId: string;
  actorUserId: string;
  action: AuditAction;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(roomAuditLog).values({
    id: `audit_${nanoid(12)}`,
    roomId: params.roomId,
    actorUserId: params.actorUserId,
    action: params.action,
    targetUserId: params.targetUserId ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ts: Date.now()
  });
}

export async function getAuditLog(roomId: string, options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = await db
    .select()
    .from(roomAuditLog)
    .where(eq(roomAuditLog.roomId, roomId))
    .orderBy(desc(roomAuditLog.ts))
    .limit(limit)
    .offset(offset);

  return rows.map((row: any) => ({
    id: row.id,
    roomId: row.roomId,
    actorUserId: row.actorUserId,
    action: row.action,
    targetUserId: row.targetUserId,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    ts: row.ts
  }));
}
