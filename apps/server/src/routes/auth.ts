import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { loginBodySchema, refreshBodySchema } from "@bunrelay/shared/validators";

import { createRefreshToken, hashToken, signAccessToken } from "../auth/jwt.ts";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { db } from "../db/index.ts";
import { sessionRefreshTokens, sessions, users } from "../db/schema.ts";
import { observeSecurityEvent } from "../services/metrics.ts";
import { authError, json, readJsonBody, zodToResponse } from "./utils.ts";

const LOGIN_LIMIT_MAX = process.env.NODE_ENV === "test" ? 1000 : 5;
const LOGIN_LIMIT_WINDOW_MS = 60_000;

const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return "local";
}

function consumeLoginAttempt(key: string): boolean {
  const now = Date.now();
  const current = loginAttempts.get(key);

  if (!current || now - current.windowStart >= LOGIN_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (current.count >= LOGIN_LIMIT_MAX) {
    return false;
  }

  current.count += 1;
  loginAttempts.set(key, current);
  return true;
}

async function handleLogin(request: Request) {
  const body = await readJsonBody(request, { maxBytes: env.HTTP_MAX_BODY_BYTES });
  if (!body.ok) {
    return body.response;
  }

  const parsed = loginBodySchema.safeParse(body.data);

  if (!parsed.success) {
    return zodToResponse(parsed.error);
  }

  const username = parsed.data.username.toLowerCase();
  const password = parsed.data.password;
  const deviceId = parsed.data.deviceId ?? "web";

  const rateLimitKey = `${getClientIp(request)}:${username}`;
  if (!consumeLoginAttempt(rateLimitKey)) {
    observeSecurityEvent("auth.login.rate_limited");
    logger.warn("auth.login.rate_limited", { username, ip: getClientIp(request) });
    return json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "too many login attempts"
        }
      },
      429
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.username, username)
  });

  if (!user) {
    return json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "invalid credentials"
        }
      },
      401
    );
  }

  const validPassword = await Bun.password.verify(password, user.passwordHash);
  if (!validPassword) {
    return json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "invalid credentials"
        }
      },
      401
    );
  }

  const now = Date.now();
  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const sessionId = nanoid(24);
  const refreshExpiresAt = now + env.JWT_REFRESH_TTL_SEC * 1000;

  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), eq(sessions.deviceId, deviceId)));

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    deviceId,
    refreshTokenHash,
    revokedAt: null,
    expiresAt: refreshExpiresAt,
    createdAt: now
  });

  await db.insert(sessionRefreshTokens).values({
    tokenHash: refreshTokenHash,
    sessionId,
    issuedAt: now
  });

  const access = await signAccessToken({
    sub: user.id,
    sid: sessionId
  });

  return json({
    accessToken: access.token,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName
    },
    deviceId
  });
}

async function handleRefresh(request: Request) {
  const body = await readJsonBody(request, { maxBytes: env.HTTP_MAX_BODY_BYTES });
  if (!body.ok) {
    return body.response;
  }

  const parsed = refreshBodySchema.safeParse(body.data);

  if (!parsed.success) {
    return zodToResponse(parsed.error);
  }

  const refreshTokenHash = hashToken(parsed.data.refreshToken);
  const now = Date.now();

  const refreshTokenRow = await db.query.sessionRefreshTokens.findFirst({
    where: eq(sessionRefreshTokens.tokenHash, refreshTokenHash)
  });

  if (!refreshTokenRow) {
    return authError(401);
  }

  if (refreshTokenRow.rotatedAt) {
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, refreshTokenRow.sessionId), isNull(sessions.revokedAt)));

    await db
      .update(sessionRefreshTokens)
      .set({ reusedAt: now })
      .where(eq(sessionRefreshTokens.tokenHash, refreshTokenHash));

    observeSecurityEvent("auth.refresh.reuse_detected");
    logger.warn("auth.refresh.reuse_detected", { sessionId: refreshTokenRow.sessionId });
    return authError(401);
  }

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, refreshTokenRow.sessionId), eq(sessions.refreshTokenHash, refreshTokenHash))
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    return authError(401);
  }

  const nextRefreshToken = createRefreshToken();
  const nextRefreshTokenHash = hashToken(nextRefreshToken);

  await db.transaction(async (tx: any) => {
    await tx
      .update(sessions)
      .set({
        refreshTokenHash: nextRefreshTokenHash
      })
      .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt), eq(sessions.refreshTokenHash, refreshTokenHash)));

    await tx
      .update(sessionRefreshTokens)
      .set({
        rotatedAt: now
      })
      .where(and(eq(sessionRefreshTokens.tokenHash, refreshTokenHash), isNull(sessionRefreshTokens.rotatedAt)));

    await tx.insert(sessionRefreshTokens).values({
      tokenHash: nextRefreshTokenHash,
      sessionId: session.id,
      issuedAt: now
    });
  });

  const access = await signAccessToken({
    sub: session.userId,
    sid: session.id
  });

  return json({
    accessToken: access.token,
    refreshToken: nextRefreshToken
  });
}

export async function handleAuthRoute(request: Request, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/auth/login") {
    return handleLogin(request);
  }

  if (request.method === "POST" && url.pathname === "/auth/refresh") {
    return handleRefresh(request);
  }

  return null;
}
