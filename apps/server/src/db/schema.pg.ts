import { bigint, index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    lastSeen: bigint("last_seen", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    usernameUnique: uniqueIndex("users_username_unique").on(table.username)
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    byUserDeviceUnique: uniqueIndex("sessions_user_device_unique").on(table.userId, table.deviceId),
    refreshTokenHashUnique: uniqueIndex("sessions_refresh_hash_unique").on(table.refreshTokenHash)
  })
);

export const sessionRefreshTokens = pgTable(
  "session_refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    rotatedAt: bigint("rotated_at", { mode: "number" }),
    reusedAt: bigint("reused_at", { mode: "number" })
  },
  (table) => ({
    bySessionIdx: index("session_refresh_tokens_session_idx").on(table.sessionId)
  })
);

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name"),
  type: text("type").notNull(),
  createdBy: text("created_by").references(() => users.id),
  createdAt: bigint("created_at", { mode: "number" }).notNull()
});

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // member | admin | owner
    joinedAt: bigint("joined_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] })
  })
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    serverTs: bigint("server_ts", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    roomServerTsIdx: index("messages_room_server_ts_idx").on(table.roomId, table.serverTs, table.id)
  })
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
    byMessageIdx: index("message_reactions_message_idx").on(table.messageId)
  })
);

export const deliveryReceipts = pgTable(
  "delivery_receipts",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    deliveredAt: bigint("delivered_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId, table.deviceId] })
  })
);

export const readCursors = pgTable(
  "read_cursors",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cursorTs: bigint("cursor_ts", { mode: "number" }).notNull(),
    cursorMsgId: text("cursor_msg_id").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] })
  })
);

export const roomAuditLog = pgTable(
  "room_audit_log",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetUserId: text("target_user_id").references(() => users.id, { onDelete: "cascade" }),
    metadata: text("metadata"),
    ts: bigint("ts", { mode: "number" }).notNull()
  },
  (table) => ({
    roomTsIdx: index("room_audit_log_room_ts_idx").on(table.roomId, table.ts)
  })
);
