import { env } from "../config/env.ts";
import { pg, sqlite } from "./index.ts";

const SQLITE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  revoked_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT sessions_user_device_unique UNIQUE (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_refresh_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  rotated_at INTEGER,
  reused_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_refresh_tokens_session_idx ON session_refresh_tokens(session_id);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  server_ts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_room_server_ts_idx ON messages(room_id, server_ts, id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

DELETE FROM message_reactions
WHERE rowid IN (
  SELECT older.rowid
  FROM message_reactions older
  JOIN message_reactions newer
    ON newer.message_id = older.message_id
   AND newer.user_id = older.user_id
   AND (
     newer.created_at > older.created_at OR
     (newer.created_at = older.created_at AND newer.rowid > older.rowid)
   )
);

CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_message_user_unique ON message_reactions(message_id, user_id);
CREATE INDEX IF NOT EXISTS message_reactions_message_idx ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS delivery_receipts (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, device_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS read_cursors (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cursor_ts INTEGER NOT NULL,
  cursor_msg_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  metadata TEXT,
  ts INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS room_audit_log_room_ts_idx ON room_audit_log(room_id, ts);
`;

const POSTGRES_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  last_seen BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  revoked_at BIGINT,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT sessions_user_device_unique UNIQUE (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_refresh_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  rotated_at BIGINT,
  reused_at BIGINT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_refresh_tokens_session_idx ON session_refresh_tokens(session_id);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  type TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  server_ts BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_room_server_ts_idx ON messages(room_id, server_ts, id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

DELETE FROM message_reactions older
USING message_reactions newer
WHERE older.message_id = newer.message_id
  AND older.user_id = newer.user_id
  AND (
    newer.created_at > older.created_at OR
    (newer.created_at = older.created_at AND newer.ctid > older.ctid)
  );

CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_message_user_unique ON message_reactions(message_id, user_id);
CREATE INDEX IF NOT EXISTS message_reactions_message_idx ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS delivery_receipts (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  delivered_at BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id, device_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS read_cursors (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cursor_ts BIGINT NOT NULL,
  cursor_msg_id TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  metadata TEXT,
  ts BIGINT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS room_audit_log_room_ts_idx ON room_audit_log(room_id, ts);
`;

const SQLITE_ALTER_SQL = `
ALTER TABLE rooms ADD COLUMN created_by TEXT REFERENCES users(id);
`;

const POSTGRES_ALTER_SQL = `
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id);
`;

export async function runMigrations() {
  if (env.DB_DRIVER === "sqlite") {
    if (!sqlite) {
      throw new Error("sqlite client not initialized");
    }
    sqlite.exec(SQLITE_MIGRATION_SQL);
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so catch error if column exists
    try {
      sqlite.exec(SQLITE_ALTER_SQL);
    } catch {
      // column already exists
    }
    return;
  }

  if (env.DB_DRIVER === "postgres") {
    if (!pg) {
      throw new Error("postgres client not initialized");
    }
    await pg.unsafe(POSTGRES_MIGRATION_SQL);
    await pg.unsafe(POSTGRES_ALTER_SQL);
    return;
  }

  throw new Error(`unsupported DB_DRIVER=${env.DB_DRIVER}`);
}

if (import.meta.main) {
  await runMigrations();
  console.log("migrations applied");
}
