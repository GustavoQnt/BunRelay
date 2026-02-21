import { and, asc, eq, or, sql } from "drizzle-orm";

import type { Cursor } from "@bunrelay/shared";

import { db } from "../db/index.ts";
import { messages, readCursors, roomMembers, rooms, users } from "../db/schema.ts";

export async function isRoomMember(userId: string, roomId: string): Promise<boolean> {
  const member = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId))
  });

  return Boolean(member);
}

export async function roomExists(roomId: string): Promise<boolean> {
  const room = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId)
  });

  return Boolean(room);
}

export async function listRoomsForUser(userId: string) {
  const rows = await db
    .select({
      id: rooms.id,
      name: rooms.name,
      type: rooms.type
    })
    .from(roomMembers)
    .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
    .where(eq(roomMembers.userId, userId))
    .orderBy(asc(rooms.id));

  return rows;
}

export async function getRoomSnapshot(_userId: string, roomId: string, cursor?: Cursor) {
  const members = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      cursorTs: readCursors.cursorTs,
      cursorMsgId: readCursors.cursorMsgId
    })
    .from(roomMembers)
    .innerJoin(users, eq(roomMembers.userId, users.id))
    .leftJoin(readCursors, and(eq(readCursors.roomId, roomId), eq(readCursors.userId, users.id)))
    .where(eq(roomMembers.roomId, roomId))
    .orderBy(asc(users.displayName));

  const messageWhere = cursor
    ? and(
        eq(messages.roomId, roomId),
        or(
          sql`${messages.serverTs} > ${cursor.ts}`,
          and(eq(messages.serverTs, cursor.ts), sql`${messages.id} > ${cursor.messageId}`)
        )
      )
    : eq(messages.roomId, roomId);

  const latestMessages = await db
    .select({
      roomId: messages.roomId,
      messageId: messages.id,
      senderId: messages.senderId,
      content: messages.content,
      ts: messages.serverTs
    })
    .from(messages)
    .where(messageWhere)
    .orderBy(asc(messages.serverTs), asc(messages.id))
    .limit(50);

  const lastMessage = latestMessages[latestMessages.length - 1];

  return {
    roomId,
    members: members.map((member: any) => ({
      userId: member.userId,
      displayName: member.displayName,
      readCursor:
        member.cursorTs !== null && member.cursorTs !== undefined && member.cursorMsgId
          ? { ts: member.cursorTs, messageId: member.cursorMsgId }
          : undefined
    })),
    messages: latestMessages,
    cursor: lastMessage ? { ts: lastMessage.ts, messageId: lastMessage.messageId } : cursor ?? null
  };
}
