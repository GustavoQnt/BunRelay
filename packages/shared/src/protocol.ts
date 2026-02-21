import { z } from "zod";

export const errorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "BAD_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "BAD_STATE",
  "INTERNAL"
]);

export const cursorSchema = z.object({
  ts: z.number().int().nonnegative(),
  messageId: z.string().min(1)
});

const baseEnvelope = z.object({
  id: z.string().min(1),
  ts: z.number().int().nonnegative()
});

export const authHelloDataSchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().min(1).max(128)
});

export const roomJoinDataSchema = z.object({
  roomId: z.string().min(1),
  cursor: cursorSchema.optional()
});

export const msgSendDataSchema = z.object({
  roomId: z.string().min(1),
  messageId: z.string().min(1),
  content: z.string().trim().min(1).max(4000)
});

export const msgDeliveredClientDataSchema = z.object({
  roomId: z.string().min(1),
  messageId: z.string().min(1)
});

export const msgReadClientDataSchema = z.object({
  roomId: z.string().min(1),
  cursor: cursorSchema
});

export const typingSetDataSchema = z.object({
  roomId: z.string().min(1),
  isTyping: z.boolean()
});

export const presencePingDataSchema = z.object({});

export const clientEventSchema = z.discriminatedUnion("type", [
  baseEnvelope.extend({
    type: z.literal("auth:hello"),
    data: authHelloDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("room:join"),
    data: roomJoinDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:send"),
    data: msgSendDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:delivered"),
    data: msgDeliveredClientDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:read"),
    data: msgReadClientDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("typing:set"),
    data: typingSetDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("presence:ping"),
    data: presencePingDataSchema
  })
]);

export const authOkDataSchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  expiresAt: z.number().int().nonnegative()
});

export const authErrorDataSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1)
});

export const roomSnapshotMemberSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  readCursor: cursorSchema.optional()
});

export const roomSnapshotMessageSchema = z.object({
  roomId: z.string().min(1),
  messageId: z.string().min(1),
  senderId: z.string().min(1),
  content: z.string().min(1),
  ts: z.number().int().nonnegative()
});

export const roomSnapshotDataSchema = z.object({
  roomId: z.string().min(1),
  members: z.array(roomSnapshotMemberSchema),
  messages: z.array(roomSnapshotMessageSchema),
  cursor: cursorSchema.nullable()
});

export const msgAckServerDataSchema = z.object({
  messageId: z.string().min(1)
});

export const msgNewDataSchema = z.object({
  roomId: z.string().min(1),
  messageId: z.string().min(1),
  senderId: z.string().min(1),
  content: z.string().min(1),
  ts: z.number().int().nonnegative()
});

export const msgDeliveredServerDataSchema = z.object({
  roomId: z.string().min(1),
  messageId: z.string().min(1),
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  ts: z.number().int().nonnegative()
});

export const msgReadServerDataSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1),
  cursor: cursorSchema
});

export const typingUpdateDataSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1),
  isTyping: z.boolean()
});

export const presenceUpdateDataSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["online", "offline"]),
  lastSeen: z.number().int().nonnegative().nullable()
});

export const errorDataSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  refId: z.string().min(1).optional()
});

export const serverEventSchema = z.discriminatedUnion("type", [
  baseEnvelope.extend({
    type: z.literal("auth:ok"),
    data: authOkDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("auth:error"),
    data: authErrorDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("room:snapshot"),
    data: roomSnapshotDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:ack_server"),
    data: msgAckServerDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:new"),
    data: msgNewDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:delivered"),
    data: msgDeliveredServerDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("msg:read"),
    data: msgReadServerDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("typing:update"),
    data: typingUpdateDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("presence:update"),
    data: presenceUpdateDataSchema
  }),
  baseEnvelope.extend({
    type: z.literal("error"),
    data: errorDataSchema
  })
]);

export type Cursor = z.infer<typeof cursorSchema>;
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;

