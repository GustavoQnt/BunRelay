import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_DRIVER: z.enum(["sqlite", "postgres"]).default("sqlite"),
  DB_URL: z.string().default("apps/server/data/dev.sqlite"),
  JWT_SECRET: z.string().min(32).default("dev-secret-change-me-at-least-32-characters"),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(604800),
  HTTP_MAX_BODY_BYTES: z.coerce.number().int().positive().default(16_384),
  WS_MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(16_384),
  WS_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(50),
  WS_AUTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  WS_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  MESSAGE_MAX_CHARS: z.coerce.number().int().positive().max(4_000).default(4_000)
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  LOG_LEVEL: parsedEnv.LOG_LEVEL ?? (parsedEnv.NODE_ENV === "test" ? "warn" : "info")
};
