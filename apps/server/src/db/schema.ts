import { env } from "../config/env.ts";
import * as pgSchema from "./schema.pg.ts";
import * as sqliteSchema from "./schema.sqlite.ts";

const schema = env.DB_DRIVER === "postgres" ? pgSchema : sqliteSchema;

export const users = schema.users as any;
export const sessions = schema.sessions as any;
export const sessionRefreshTokens = schema.sessionRefreshTokens as any;
export const rooms = schema.rooms as any;
export const roomMembers = schema.roomMembers as any;
export const messages = schema.messages as any;
export const messageReactions = schema.messageReactions as any;
export const deliveryReceipts = schema.deliveryReceipts as any;
export const readCursors = schema.readCursors as any;
export const roomAuditLog = schema.roomAuditLog as any;
