import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    lastSeen: integer("last_seen", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    usernameUnique: uniqueIndex("users_username_unique").on(table.username)
  })
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    byUserDeviceUnique: uniqueIndex("sessions_user_device_unique").on(table.userId, table.deviceId),
    refreshTokenHashUnique: uniqueIndex("sessions_refresh_hash_unique").on(table.refreshTokenHash)
  })
);

export const sessionRefreshTokens = sqliteTable(
  "session_refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    issuedAt: integer("issued_at", { mode: "number" }).notNull(),
    rotatedAt: integer("rotated_at", { mode: "number" }),
    reusedAt: integer("reused_at", { mode: "number" })
  },
  (table) => ({
    bySessionIdx: index("session_refresh_tokens_session_idx").on(table.sessionId)
  })
);

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name"),
  type: text("type", { enum: ["dm", "group"] }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull()
});

export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["member", "admin"] }).notNull(),
    joinedAt: integer("joined_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] })
  })
);

export const messages = sqliteTable(
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
    serverTs: integer("server_ts", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    roomServerTsIdx: index("messages_room_server_ts_idx").on(table.roomId, table.serverTs, table.id)
  })
);

export const deliveryReceipts = sqliteTable(
  "delivery_receipts",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    deliveredAt: integer("delivered_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId, table.deviceId] })
  })
);

export const readCursors = sqliteTable(
  "read_cursors",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cursorTs: integer("cursor_ts", { mode: "number" }).notNull(),
    cursorMsgId: text("cursor_msg_id").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] })
  })
);

