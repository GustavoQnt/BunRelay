import { requireAuth } from "../auth/middleware.ts";
import {
  addMemberToRoom,
  countRoomAdmins,
  createGroupRoom,
  createOrGetDmRoom,
  getRoomById,
  getRoomMember,
  getRoomSnapshot,
  isRoomMember,
  listRoomsForUser,
  listRoomMembersWithProfile,
  removeMemberFromRoom,
  roomExists,
  transferOwnership,
  updateRoomMemberRole,
  usersThatExist
} from "../services/room.ts";
import { logAuditEvent, getAuditLog } from "../services/audit.ts";
import { json, readJsonBody, zodToResponse } from "./utils.ts";
import { broadcastRoomMemberUpdate } from "../ws/broadcast.ts";
import {
  addRoomMemberBodySchema,
  createDmBodySchema,
  createGroupBodySchema,
  transferOwnershipBodySchema,
  updateRoomMemberRoleBodySchema
} from "@bunrelay/shared/validators";

function parseRoomMessagesPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "messages") {
    return parts[1] ?? null;
  }
  return null;
}

function parseRoomMembersPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "members") {
    return parts[1] ?? null;
  }
  return null;
}

function parseRoomMemberPath(pathname: string): { roomId: string; userId: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 4 && parts[0] === "rooms" && parts[2] === "members") {
    const roomId = parts[1];
    const userId = parts[3];
    if (roomId && userId) {
      return { roomId, userId };
    }
  }
  return null;
}

function parseRoomMemberRolePath(pathname: string): { roomId: string; userId: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 5 && parts[0] === "rooms" && parts[2] === "members" && parts[4] === "role") {
    const roomId = parts[1];
    const userId = parts[3];
    if (roomId && userId) {
      return { roomId, userId };
    }
  }
  return null;
}

function parseRoomOwnerPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "owner") {
    return parts[1] ?? null;
  }
  return null;
}

function parseRoomAuditPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "audit") {
    return parts[1] ?? null;
  }
  return null;
}

export async function handleRoomsRoute(request: Request, url: URL): Promise<Response | null> {
  const isRoomsList = url.pathname === "/rooms";
  const roomId = parseRoomMessagesPath(url.pathname);
  const isRoomMessages = Boolean(roomId);
  const isCreateDm = request.method === "POST" && url.pathname === "/rooms/dm";
  const isCreateGroup = request.method === "POST" && url.pathname === "/rooms/groups";
  const roomMembersRoomId = request.method === "POST" ? parseRoomMembersPath(url.pathname) : null;
  const roomMembersListRoomId = request.method === "GET" ? parseRoomMembersPath(url.pathname) : null;
  const roomMemberTarget = request.method === "DELETE" ? parseRoomMemberPath(url.pathname) : null;
  const roomMemberRoleTarget = request.method === "PATCH" ? parseRoomMemberRolePath(url.pathname) : null;
  const ownerTransferRoomId = request.method === "PATCH" ? parseRoomOwnerPath(url.pathname) : null;
  const auditRoomId = request.method === "GET" ? parseRoomAuditPath(url.pathname) : null;
  const isAddGroupMember = Boolean(roomMembersRoomId);
  const isListRoomMembers = Boolean(roomMembersListRoomId);
  const isRemoveGroupMember = Boolean(roomMemberTarget);
  const isUpdateGroupMemberRole = Boolean(roomMemberRoleTarget);
  const isOwnerTransfer = Boolean(ownerTransferRoomId);
  const isAuditLog = Boolean(auditRoomId);

  if (
    !isRoomsList &&
    !isRoomMessages &&
    !isCreateDm &&
    !isCreateGroup &&
    !isAddGroupMember &&
    !isListRoomMembers &&
    !isRemoveGroupMember &&
    !isUpdateGroupMemberRole &&
    !isOwnerTransfer &&
    !isAuditLog
  ) {
    return null;
  }

  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE" && request.method !== "PATCH") {
    return null;
  }

  const auth = await requireAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  if (isCreateDm) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = createDmBodySchema.safeParse(body.data);
    if (!parsed.success) {
      return zodToResponse(parsed.error);
    }

    const peerUserId = parsed.data.peerUserId;
    if (peerUserId === auth.auth.userId) {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "cannot create dm with yourself"
          }
        },
        400
      );
    }

    const existingUsers = await usersThatExist([peerUserId]);
    if (!existingUsers.has(peerUserId)) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "peer user not found"
          }
        },
        404
      );
    }

    const created = await createOrGetDmRoom(auth.auth.userId, peerUserId);
    return json(
      {
        room: created.room,
        created: created.created
      },
      created.created ? 201 : 200
    );
  }

  if (isListRoomMembers) {
    const room = await getRoomById(roomMembersListRoomId!);
    if (!room) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "room not found"
          }
        },
        404
      );
    }

    const member = await isRoomMember(auth.auth.userId, roomMembersListRoomId!);
    if (!member) {
      return json(
        {
          error: {
            code: "FORBIDDEN",
            message: "not a room member"
          }
        },
        403
      );
    }

    const members = await listRoomMembersWithProfile(roomMembersListRoomId!);
    return json({
      roomId: roomMembersListRoomId,
      members
    });
  }

  if (isCreateGroup) {
    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = createGroupBodySchema.safeParse(body.data);
    if (!parsed.success) {
      return zodToResponse(parsed.error);
    }

    const uniqueRequestedMembers = [...new Set(parsed.data.memberIds.filter((id) => id !== auth.auth.userId))];
    if (uniqueRequestedMembers.length === 0) {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "group must include at least one other member"
          }
        },
        400
      );
    }

    const existingUsers = await usersThatExist(uniqueRequestedMembers);
    const missingUserIds = uniqueRequestedMembers.filter((userId) => !existingUsers.has(userId));
    if (missingUserIds.length > 0) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "one or more members were not found",
            missingUserIds
          }
        },
        404
      );
    }

    const created = await createGroupRoom({
      creatorUserId: auth.auth.userId,
      name: parsed.data.name,
      memberIds: uniqueRequestedMembers
    });

    await logAuditEvent({
      roomId: created.room.id,
      actorUserId: auth.auth.userId,
      action: "room_created",
      metadata: { name: parsed.data.name, memberCount: created.memberIds.length }
    });

    return json(
      {
        room: created.room,
        memberIds: created.memberIds,
        created: true
      },
      201
    );
  }

  if (isAddGroupMember) {
    const room = await getRoomById(roomMembersRoomId!);
    if (!room) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "room not found"
          }
        },
        404
      );
    }

    if (room.type !== "group") {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "members can only be managed for group rooms"
          }
        },
        400
      );
    }

    const requesterMembership = await getRoomMember(roomMembersRoomId!, auth.auth.userId);
    if (!requesterMembership || (requesterMembership.role !== "admin" && requesterMembership.role !== "owner")) {
      return json(
        {
          error: {
            code: "FORBIDDEN",
            message: "admin role required"
          }
        },
        403
      );
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = addRoomMemberBodySchema.safeParse(body.data);
    if (!parsed.success) {
      return zodToResponse(parsed.error);
    }

    const targetUserId = parsed.data.userId;
    const existingUsers = await usersThatExist([targetUserId]);
    if (!existingUsers.has(targetUserId)) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "user not found"
          }
        },
        404
      );
    }

    const added = await addMemberToRoom({
      roomId: roomMembersRoomId!,
      userId: targetUserId,
      role: "member"
    });

    if (added) {
      await broadcastRoomMemberUpdate({
        roomId: roomMembersRoomId!,
        userId: targetUserId,
        action: "added",
        role: "member",
        actorUserId: auth.auth.userId
      });
      await logAuditEvent({
        roomId: roomMembersRoomId!,
        actorUserId: auth.auth.userId,
        action: "added",
        targetUserId
      });
    }

    return json(
      {
        roomId: roomMembersRoomId,
        userId: targetUserId,
        added
      },
      added ? 201 : 200
    );
  }

  if (isRemoveGroupMember) {
    const room = await getRoomById(roomMemberTarget!.roomId);
    if (!room) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "room not found"
          }
        },
        404
      );
    }

    if (room.type !== "group") {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "members can only be managed for group rooms"
          }
        },
        400
      );
    }

    const requesterMembership = await getRoomMember(roomMemberTarget!.roomId, auth.auth.userId);
    if (!requesterMembership || (requesterMembership.role !== "admin" && requesterMembership.role !== "owner")) {
      return json(
        {
          error: {
            code: "FORBIDDEN",
            message: "admin role required"
          }
        },
        403
      );
    }

    const targetMembership = await getRoomMember(roomMemberTarget!.roomId, roomMemberTarget!.userId);
    if (!targetMembership) {
      return json({
        roomId: roomMemberTarget!.roomId,
        userId: roomMemberTarget!.userId,
        removed: false
      });
    }

    if (targetMembership.role === "owner") {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "cannot remove the owner from group"
          }
        },
        400
      );
    }

    if (targetMembership.role === "admin") {
      const adminCount = await countRoomAdmins(roomMemberTarget!.roomId);
      if (adminCount <= 1) {
        return json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "cannot remove the last admin from group"
            }
          },
          400
        );
      }
    }

    const removed = await removeMemberFromRoom(roomMemberTarget!.roomId, roomMemberTarget!.userId);
    if (removed) {
      await broadcastRoomMemberUpdate({
        roomId: roomMemberTarget!.roomId,
        userId: roomMemberTarget!.userId,
        action: "removed",
        actorUserId: auth.auth.userId,
        includeUserIds: [roomMemberTarget!.userId]
      });
      await logAuditEvent({
        roomId: roomMemberTarget!.roomId,
        actorUserId: auth.auth.userId,
        action: "removed",
        targetUserId: roomMemberTarget!.userId
      });
    }

    return json({
      roomId: roomMemberTarget!.roomId,
      userId: roomMemberTarget!.userId,
      removed
    });
  }

  if (isUpdateGroupMemberRole) {
    const room = await getRoomById(roomMemberRoleTarget!.roomId);
    if (!room) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "room not found"
          }
        },
        404
      );
    }

    if (room.type !== "group") {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "members can only be managed for group rooms"
          }
        },
        400
      );
    }

    const requesterMembership = await getRoomMember(roomMemberRoleTarget!.roomId, auth.auth.userId);
    if (!requesterMembership || (requesterMembership.role !== "admin" && requesterMembership.role !== "owner")) {
      return json(
        {
          error: {
            code: "FORBIDDEN",
            message: "admin role required"
          }
        },
        403
      );
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = updateRoomMemberRoleBodySchema.safeParse(body.data);
    if (!parsed.success) {
      return zodToResponse(parsed.error);
    }

    const targetMembership = await getRoomMember(roomMemberRoleTarget!.roomId, roomMemberRoleTarget!.userId);
    if (!targetMembership) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "member not found"
          }
        },
        404
      );
    }

    if (targetMembership.role === "owner") {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "cannot change the owner's role directly; use ownership transfer"
          }
        },
        400
      );
    }

    if (targetMembership.role === "admin" && parsed.data.role === "member") {
      const adminCount = await countRoomAdmins(roomMemberRoleTarget!.roomId);
      if (adminCount <= 1) {
        return json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "cannot demote the last admin from group"
            }
          },
          400
        );
      }
    }

    const oldRole = targetMembership.role;
    const updated = await updateRoomMemberRole({
      roomId: roomMemberRoleTarget!.roomId,
      userId: roomMemberRoleTarget!.userId,
      role: parsed.data.role
    });

    if (updated.changed) {
      await broadcastRoomMemberUpdate({
        roomId: roomMemberRoleTarget!.roomId,
        userId: roomMemberRoleTarget!.userId,
        action: "role_updated",
        role: parsed.data.role,
        actorUserId: auth.auth.userId
      });
      await logAuditEvent({
        roomId: roomMemberRoleTarget!.roomId,
        actorUserId: auth.auth.userId,
        action: "role_updated",
        targetUserId: roomMemberRoleTarget!.userId,
        metadata: { oldRole, newRole: parsed.data.role }
      });
    }

    return json({
      roomId: roomMemberRoleTarget!.roomId,
      userId: roomMemberRoleTarget!.userId,
      role: parsed.data.role,
      changed: updated.changed
    });
  }

  if (isOwnerTransfer) {
    const room = await getRoomById(ownerTransferRoomId!);
    if (!room) {
      return json({ error: { code: "NOT_FOUND", message: "room not found" } }, 404);
    }
    if (room.type !== "group") {
      return json({ error: { code: "BAD_REQUEST", message: "ownership transfer only for group rooms" } }, 400);
    }

    const requesterMembership = await getRoomMember(ownerTransferRoomId!, auth.auth.userId);
    if (!requesterMembership || requesterMembership.role !== "owner") {
      return json({ error: { code: "FORBIDDEN", message: "only the owner can transfer ownership" } }, 403);
    }

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = transferOwnershipBodySchema.safeParse(body.data);
    if (!parsed.success) return zodToResponse(parsed.error);

    const targetMembership = await getRoomMember(ownerTransferRoomId!, parsed.data.userId);
    if (!targetMembership) {
      return json({ error: { code: "NOT_FOUND", message: "target user is not a member" } }, 404);
    }

    const transferred = await transferOwnership(ownerTransferRoomId!, auth.auth.userId, parsed.data.userId);
    if (!transferred) {
      return json({ error: { code: "INTERNAL", message: "ownership transfer failed" } }, 500);
    }

    await broadcastRoomMemberUpdate({
      roomId: ownerTransferRoomId!,
      userId: parsed.data.userId,
      action: "owner_transferred",
      role: "owner",
      actorUserId: auth.auth.userId
    });

    await logAuditEvent({
      roomId: ownerTransferRoomId!,
      actorUserId: auth.auth.userId,
      action: "owner_transferred",
      targetUserId: parsed.data.userId
    });

    return json({
      roomId: ownerTransferRoomId,
      previousOwner: auth.auth.userId,
      newOwner: parsed.data.userId
    });
  }

  if (isAuditLog) {
    const room = await getRoomById(auditRoomId!);
    if (!room) {
      return json({ error: { code: "NOT_FOUND", message: "room not found" } }, 404);
    }

    const requesterMembership = await getRoomMember(auditRoomId!, auth.auth.userId);
    if (!requesterMembership || (requesterMembership.role !== "admin" && requesterMembership.role !== "owner")) {
      return json({ error: { code: "FORBIDDEN", message: "admin or owner role required" } }, 403);
    }

    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const limit = limitParam ? Math.min(Math.max(1, Number(limitParam)), 100) : 50;
    const offset = offsetParam ? Math.max(0, Number(offsetParam)) : 0;

    const entries = await getAuditLog(auditRoomId!, { limit, offset });
    return json({ roomId: auditRoomId, entries });
  }

  if (isRoomsList) {
    const rooms = await listRoomsForUser(auth.auth.userId);
    return json({ rooms });
  }

  if (!roomId) {
    return null;
  }

  const exists = await roomExists(roomId);
  if (!exists) {
    return json(
      {
        error: {
          code: "NOT_FOUND",
          message: "room not found"
        }
      },
      404
    );
  }

  const isMember = await isRoomMember(auth.auth.userId, roomId);
  if (!isMember) {
    return json(
      {
        error: {
          code: "FORBIDDEN",
          message: "not a room member"
        }
      },
      403
    );
  }

  const cursorTsParam = url.searchParams.get("cursorTs");
  const cursorMsgIdParam = url.searchParams.get("cursorMsgId");
  const cursorTs = cursorTsParam ? Number(cursorTsParam) : undefined;

  if (cursorTsParam && (!Number.isFinite(cursorTs) || !cursorMsgIdParam)) {
    return json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "invalid cursor"
        }
      },
      400
    );
  }

  const cursor =
    cursorTsParam && cursorMsgIdParam
      ? {
          ts: cursorTs!,
          messageId: cursorMsgIdParam
        }
      : undefined;

  const snapshot = await getRoomSnapshot(auth.auth.userId, roomId, cursor);

  return json({
    roomId,
    messages: snapshot.messages,
    cursor: snapshot.cursor
  });
}
