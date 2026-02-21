import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

export let sqlite: Database | null = null;
export let pg: postgres.Sql | null = null;

if (env.DB_DRIVER === "sqlite") {
  if (env.DB_URL !== ":memory:") {
    mkdirSync(dirname(env.DB_URL), { recursive: true });
  }

  sqlite = new Database(env.DB_URL, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");
}

if (env.DB_DRIVER === "postgres") {
  pg = postgres(env.DB_URL, {
    max: 10,
    idle_timeout: 10
  });
}

export const db: any =
  env.DB_DRIVER === "sqlite"
    ? drizzle(sqlite!, { schema })
    : drizzlePg(pg!, {
        schema: schema as any
      });
