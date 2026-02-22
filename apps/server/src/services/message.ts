import { and, eq, ne } from "drizzle-orm";

import type { Cursor } from "@bunrelay/shared";

import { db } from "../db/index.ts";
import { deliveryReceipts, messageReactions, messages, readCursors } from "../db/schema.ts";

type PersistMessageInput = {
  roomId: string;
  senderId: string;
  messageId: string;
  content: string;
};

type SetReactionInput = {
  roomId: string;
  messageId: string;
  userId: string;
  emoji: string;
  active: boolean;
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

export async function setMessageReaction(input: SetReactionInput) {
  const message = await db.query.messages.findFirst({
    where: and(eq(messages.id, input.messageId), eq(messages.roomId, input.roomId))
  });

  if (!message) {
    return null;
  }

  const existingRows = await db
    .select({
      emoji: messageReactions.emoji
    })
    .from(messageReactions)
    .where(
      and(
      eq(messageReactions.messageId, input.messageId),
      eq(messageReactions.userId, input.userId)
      )
    );

  if (input.active) {
    const hasSameReaction = existingRows.some((row: any) => row.emoji === input.emoji);

    if (hasSameReaction && existingRows.length === 1) {
      return {
        changes: []
      };
    }

    const now = Date.now();

    if (hasSameReaction) {
      const removed = existingRows.filter((row: any) => row.emoji !== input.emoji);
      await db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, input.messageId),
            eq(messageReactions.userId, input.userId),
            ne(messageReactions.emoji, input.emoji)
          )
        );

      return {
        changes: removed.map((row: any) => ({
          roomId: input.roomId,
          messageId: input.messageId,
          emoji: row.emoji,
          userId: input.userId,
          active: false,
          ts: now
        }))
      };
    }

    await db.transaction(async (tx: any) => {
      await tx
        .delete(messageReactions)
        .where(and(eq(messageReactions.messageId, input.messageId), eq(messageReactions.userId, input.userId)));

      await tx.insert(messageReactions).values({
        messageId: input.messageId,
        userId: input.userId,
        emoji: input.emoji,
        createdAt: now
      });
    });

    return {
      changes: [
        ...existingRows.map((row: any) => ({
          roomId: input.roomId,
          messageId: input.messageId,
          emoji: row.emoji,
          userId: input.userId,
          active: false,
          ts: now
        })),
        {
          roomId: input.roomId,
          messageId: input.messageId,
          emoji: input.emoji,
          userId: input.userId,
          active: true,
          ts: now
        }
      ]
    };
  }

  const hasTargetReaction = existingRows.some((row: any) => row.emoji === input.emoji);
  if (!hasTargetReaction) {
    return {
      changes: []
    };
  }

  const ts = Date.now();
  await db
    .delete(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, input.messageId),
        eq(messageReactions.userId, input.userId),
        eq(messageReactions.emoji, input.emoji)
      )
    );

  return {
    changes: [
      {
        roomId: input.roomId,
        messageId: input.messageId,
        emoji: input.emoji,
        userId: input.userId,
        active: false,
        ts
      }
    ]
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
