import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Cursor } from "@bunrelay/shared";

import { db } from "../db/index.ts";
import { messageReactions, messages, readCursors, roomMembers, rooms, users } from "../db/schema.ts";

type RoomSummary = {
  id: string;
  name: string | null;
  type: "dm" | "group";
};

type RoomMemberSummary = {
  roomId: string;
  userId: string;
  role: "member" | "admin" | "owner";
};

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

export async function getRoomById(roomId: string): Promise<RoomSummary | null> {
  const room = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId)
  });

  if (!room) {
    return null;
  }

  return {
    id: room.id,
    name: room.name,
    type: room.type
  };
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

export async function listRoomMemberIds(roomId: string): Promise<string[]> {
  const rows = await db
    .select({
      userId: roomMembers.userId
    })
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId));

  return rows.map((row: any) => row.userId);
}

async function listDmRoomsForUser(userId: string): Promise<RoomSummary[]> {
  const rows = await db
    .select({
      id: rooms.id,
      name: rooms.name,
      type: rooms.type
    })
    .from(roomMembers)
    .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
    .where(and(eq(roomMembers.userId, userId), eq(rooms.type, "dm")))
    .orderBy(asc(rooms.id));

  return rows as RoomSummary[];
}

export async function findExistingDmBetweenUsers(userId: string, peerUserId: string): Promise<RoomSummary | null> {
  const candidates = await listDmRoomsForUser(userId);

  for (const candidate of candidates) {
    const members = await db
      .select({
        userId: roomMembers.userId
      })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, candidate.id))
      .limit(3);

    if (members.length !== 2) {
      continue;
    }

    const ids = members.map((member: any) => member.userId);
    if (ids.includes(userId) && ids.includes(peerUserId)) {
      return candidate;
    }
  }

  return null;
}

export async function usersThatExist(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const unique = [...new Set(userIds)];
  const rows = await db
    .select({
      id: users.id
    })
    .from(users)
    .where(inArray(users.id, unique));

  return new Set(rows.map((row: any) => row.id));
}

export async function getRoomMember(roomId: string, userId: string): Promise<RoomMemberSummary | null> {
  const member = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId))
  });

  if (!member) {
    return null;
  }

  return {
    roomId: member.roomId,
    userId: member.userId,
    role: member.role
  };
}

export async function listRoomMembersWithProfile(roomId: string): Promise<
  Array<{
    userId: string;
    displayName: string;
    role: "member" | "admin" | "owner";
  }>
> {
  const members = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      role: roomMembers.role
    })
    .from(roomMembers)
    .innerJoin(users, eq(roomMembers.userId, users.id))
    .where(eq(roomMembers.roomId, roomId))
    .orderBy(asc(users.displayName));

  return members as Array<{
    userId: string;
    displayName: string;
    role: "member" | "admin" | "owner";
  }>;
}

export async function addMemberToRoom(params: {
  roomId: string;
  userId: string;
  role?: "member" | "admin" | "owner";
}): Promise<boolean> {
  const existing = await getRoomMember(params.roomId, params.userId);
  if (existing) {
    return false;
  }

  await db
    .insert(roomMembers)
    .values({
      roomId: params.roomId,
      userId: params.userId,
      role: params.role ?? "member",
      joinedAt: Date.now()
    })
    .onConflictDoNothing();

  return true;
}

export async function removeMemberFromRoom(roomId: string, userId: string): Promise<boolean> {
  const existing = await getRoomMember(roomId, userId);
  if (!existing) {
    return false;
  }

  await db.delete(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
  return true;
}

export async function updateRoomMemberRole(params: {
  roomId: string;
  userId: string;
  role: "member" | "admin" | "owner";
}): Promise<{ changed: boolean; member: RoomMemberSummary | null }> {
  const existing = await getRoomMember(params.roomId, params.userId);
  if (!existing) {
    return {
      changed: false,
      member: null
    };
  }

  if (existing.role === params.role) {
    return {
      changed: false,
      member: existing
    };
  }

  await db
    .update(roomMembers)
    .set({
      role: params.role
    })
    .where(and(eq(roomMembers.roomId, params.roomId), eq(roomMembers.userId, params.userId)));

  return {
    changed: true,
    member: {
      roomId: params.roomId,
      userId: params.userId,
      role: params.role
    }
  };
}

export async function countRoomAdmins(roomId: string): Promise<number> {
  const rows = await db
    .select({
      count: sql<number>`count(*)`
    })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.role, "admin")));

  return Number(rows[0]?.count ?? 0);
}

export async function countRoomOwners(roomId: string): Promise<number> {
  const rows = await db
    .select({
      count: sql<number>`count(*)`
    })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.role, "owner")));

  return Number(rows[0]?.count ?? 0);
}

export async function transferOwnership(
  roomId: string,
  fromUserId: string,
  toUserId: string
): Promise<boolean> {
  const from = await getRoomMember(roomId, fromUserId);
  const to = await getRoomMember(roomId, toUserId);

  if (!from || from.role !== "owner" || !to) {
    return false;
  }

  await db.transaction(async (tx: any) => {
    await tx
      .update(roomMembers)
      .set({ role: "admin" })
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, fromUserId)));

    await tx
      .update(roomMembers)
      .set({ role: "owner" })
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, toUserId)));
  });

  return true;
}

export async function createOrGetDmRoom(userId: string, peerUserId: string): Promise<{ room: RoomSummary; created: boolean }> {
  const existing = await findExistingDmBetweenUsers(userId, peerUserId);
  if (existing) {
    return {
      room: existing,
      created: false
    };
  }

  const sorted = [userId, peerUserId].sort();
  const roomId = `room_dm_${sorted[0]}_${sorted[1]}`;
  const now = Date.now();

  const existingByDeterministicId = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId)
  });

  await db.transaction(async (tx: any) => {
    await tx
      .insert(rooms)
      .values({
        id: roomId,
        name: null,
        type: "dm",
        createdAt: now
      })
      .onConflictDoNothing();

    await tx
      .insert(roomMembers)
      .values([
        {
          roomId,
          userId,
          role: "member",
          joinedAt: now
        },
        {
          roomId,
          userId: peerUserId,
          role: "member",
          joinedAt: now
        }
      ])
      .onConflictDoNothing();
  });

  const room = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId)
  });

  if (!room) {
    throw new Error("failed to load dm room");
  }

  return {
    room: {
      id: room.id,
      name: room.name,
      type: room.type
    },
    created: !existingByDeterministicId
  };
}

export async function createGroupRoom(params: {
  creatorUserId: string;
  name: string;
  memberIds: string[];
}): Promise<{ room: RoomSummary; memberIds: string[] }> {
  const now = Date.now();
  const roomId = `room_group_${nanoid(12)}`;
  const memberIds = [...new Set([params.creatorUserId, ...params.memberIds])];

  await db.transaction(async (tx: any) => {
    await tx.insert(rooms).values({
      id: roomId,
      name: params.name,
      type: "group",
      createdBy: params.creatorUserId,
      createdAt: now
    });

    await tx.insert(roomMembers).values(
      memberIds.map((memberId) => ({
        roomId,
        userId: memberId,
        role: memberId === params.creatorUserId ? "owner" : "member",
        joinedAt: now
      }))
    );
  });

  return {
    room: {
      id: roomId,
      name: params.name,
      type: "group"
    },
    memberIds
  };
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

  const messageIds = latestMessages.map((message: any) => message.messageId);
  const reactionsByMessage = new Map<string, Array<{ emoji: string; userId: string }>>();

  if (messageIds.length > 0) {
    const reactionRows = await db
      .select({
        messageId: messageReactions.messageId,
        emoji: messageReactions.emoji,
        userId: messageReactions.userId,
        createdAt: messageReactions.createdAt
      })
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, messageIds))
      .orderBy(asc(messageReactions.createdAt), asc(messageReactions.emoji), asc(messageReactions.userId));

    const latestByMessageUser = new Map<string, Map<string, { emoji: string; createdAt: number }>>();

    for (const reaction of reactionRows) {
      if (!latestByMessageUser.has(reaction.messageId)) {
        latestByMessageUser.set(reaction.messageId, new Map());
      }

      const byUser = latestByMessageUser.get(reaction.messageId)!;
      const previous = byUser.get(reaction.userId);
      if (!previous || previous.createdAt <= reaction.createdAt) {
        byUser.set(reaction.userId, {
          emoji: reaction.emoji,
          createdAt: reaction.createdAt
        });
      }
    }

    for (const [messageId, byUser] of latestByMessageUser.entries()) {
      const current = reactionsByMessage.get(messageId) ?? [];
      for (const [userId, reaction] of byUser.entries()) {
        current.push({
          emoji: reaction.emoji,
          userId
        });
      }
      reactionsByMessage.set(messageId, current);
    }
  }

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
    messages: latestMessages.map((message: any) => ({
      ...message,
      reactions: reactionsByMessage.get(message.messageId) ?? []
    })),
    cursor: lastMessage ? { ts: lastMessage.ts, messageId: lastMessage.messageId } : cursor ?? null
  };
}
