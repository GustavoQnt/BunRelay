import { and, eq } from "drizzle-orm";

import type { Cursor } from "@bunrelay/shared";

import { db } from "../db/index.ts";
import { deliveryReceipts, messages, readCursors } from "../db/schema.ts";

type PersistMessageInput = {
  roomId: string;
  senderId: string;
  messageId: string;
  content: string;
};

export async function persistMessage(input: PersistMessageInput) {
  const now = Date.now();

  const existing = await db.query.messages.findFirst({
    where: eq(messages.id, input.messageId)
  });

  if (existing) {
    return {
      isNew: false as const,
      roomId: existing.roomId,
      messageId: existing.id,
      senderId: existing.senderId,
      content: existing.content,
      ts: existing.serverTs
    };
  }

  await db
    .insert(messages)
    .values({
      id: input.messageId,
      roomId: input.roomId,
      senderId: input.senderId,
      content: input.content,
      serverTs: now,
      createdAt: now
    })
    .onConflictDoNothing();

  return {
    isNew: true as const,
    roomId: input.roomId,
    messageId: input.messageId,
    senderId: input.senderId,
    content: input.content,
    ts: now
  };
}

export async function markDelivered(params: {
  roomId: string;
  messageId: string;
  userId: string;
  deviceId: string;
}) {
  const message = await db.query.messages.findFirst({
    where: and(eq(messages.id, params.messageId), eq(messages.roomId, params.roomId))
  });

  if (!message) {
    return null;
  }

  const deliveredAt = Date.now();

  await db
    .insert(deliveryReceipts)
    .values({
      messageId: params.messageId,
      userId: params.userId,
      deviceId: params.deviceId,
      deliveredAt
    })
    .onConflictDoNothing();

  return {
    roomId: params.roomId,
    messageId: params.messageId,
    userId: params.userId,
    deviceId: params.deviceId,
    ts: deliveredAt
  };
}

export async function upsertReadCursor(params: { roomId: string; userId: string; cursor: Cursor }) {
  const updatedAt = Date.now();

  await db
    .insert(readCursors)
    .values({
      roomId: params.roomId,
      userId: params.userId,
      cursorTs: params.cursor.ts,
      cursorMsgId: params.cursor.messageId,
      updatedAt
    })
    .onConflictDoUpdate({
      target: [readCursors.roomId, readCursors.userId],
      set: {
        cursorTs: params.cursor.ts,
        cursorMsgId: params.cursor.messageId,
        updatedAt
      }
    });

  return {
    roomId: params.roomId,
    userId: params.userId,
    cursor: params.cursor
  };
}

