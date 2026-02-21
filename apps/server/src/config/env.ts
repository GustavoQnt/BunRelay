import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === "boolean") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `invalid boolean value "${value}"`
    });
    return z.NEVER;
  });

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
  MESSAGE_MAX_CHARS: z.coerce.number().int().positive().max(4_000).default(4_000),

  // Redis (optional, for multi-instance pub/sub)
  REDIS_URL: z.string().optional(),

  // Distributed tracing (OTLP/HTTP)
  TRACING_ENABLED: booleanFromEnv.transform((value) => value ?? false),
  TRACING_SERVICE_NAME: z.string().default("bunrelay-server"),
  TRACING_OTLP_HTTP_URL: z.string().optional(),
  TRACING_OTLP_HEADERS: z.string().optional(),
  TRACING_SAMPLING_RATIO: z.coerce.number().min(0).max(1).default(1),
  TRACING_EXPORT_BATCH_SIZE: z.coerce.number().int().positive().default(64),
  TRACING_EXPORT_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  TRACING_EXPORT_TIMEOUT_MS: z.coerce.number().int().positive().default(2_500),

  // External log sink (generic HTTP)
  LOG_SINK_HTTP_URLS: z.string().optional(),
  LOG_SINK_HTTP_HEADERS: z.string().optional(),
  LOG_SINK_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  LOG_SINK_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  LOG_SINK_TIMEOUT_MS: z.coerce.number().int().positive().default(2_500),
  LOG_SINK_BUFFER_MAX: z.coerce.number().int().positive().default(2_000)
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  LOG_LEVEL: parsedEnv.LOG_LEVEL ?? (parsedEnv.NODE_ENV === "test" ? "warn" : "info"),
  TRACING_ENABLED: parsedEnv.TRACING_ENABLED || Boolean(parsedEnv.TRACING_OTLP_HTTP_URL?.trim()),
  TRACING_OTLP_HTTP_URL: parsedEnv.TRACING_OTLP_HTTP_URL?.trim() || undefined,
  TRACING_OTLP_HEADERS: parsedEnv.TRACING_OTLP_HEADERS?.trim() || undefined,
  LOG_SINK_HTTP_URLS: parsedEnv.LOG_SINK_HTTP_URLS?.trim() || undefined,
  LOG_SINK_HTTP_HEADERS: parsedEnv.LOG_SINK_HTTP_HEADERS?.trim() || undefined,
  REDIS_URL: parsedEnv.REDIS_URL?.trim() || undefined
};
