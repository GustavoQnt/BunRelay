import { requireAuth } from "../auth/middleware.ts";
import { getRoomSnapshot, isRoomMember, listRoomsForUser, roomExists } from "../services/room.ts";
import { json } from "./utils.ts";

function parseRoomMessagesPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "rooms" && parts[2] === "messages") {
    return parts[1] ?? null;
  }
  return null;
}

export async function handleRoomsRoute(request: Request, url: URL): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }

  const auth = await requireAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  if (url.pathname === "/rooms") {
    const rooms = await listRoomsForUser(auth.auth.userId);
    return json({ rooms });
  }

  const roomId = parseRoomMessagesPath(url.pathname);
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
