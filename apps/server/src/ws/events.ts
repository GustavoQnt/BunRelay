import { nanoid } from "nanoid";

import { serverEventSchema } from "@bunrelay/shared";
import type { ErrorCode } from "@bunrelay/shared";

import { logger } from "../config/logger.ts";
import { observeWsMessageOut } from "../services/metrics.ts";
import type { ServerSocket } from "./types.ts";

export function sendEvent(socket: ServerSocket, type: string, data: unknown): void {
  const event = {
    type,
    id: `evt_${nanoid(10)}`,
    ts: Date.now(),
    data
  };

  const parsed = serverEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.error("ws.invalid_server_event", {
      connectionId: socket.data.connectionId,
      type,
      issues: parsed.error.issues.length
    });
    return;
  }

  socket.send(JSON.stringify(event));
  observeWsMessageOut(type);
}

export function sendError(
  socket: ServerSocket,
  code: ErrorCode,
  message: string,
  refId?: string
): void {
  sendEvent(socket, "error", {
    code,
    message,
    refId
  });
}
