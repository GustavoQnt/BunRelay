import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "../db/index.ts";
import { sessions } from "../db/schema.ts";
import { authError } from "../routes/utils.ts";
import { verifyAccessToken } from "./jwt.ts";

export type AuthContext = {
  userId: string;
  sessionId: string;
};

type RequireAuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: Response };

export async function requireAuth(request: Request): Promise<RequireAuthResult> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, response: authError(401) };
  }

  const token = authHeader.slice("Bearer ".length);

  let claims: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    return { ok: false, response: authError(401) };
  }

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, claims.sid),
      eq(sessions.userId, claims.sub),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, Date.now())
    )
  });

  if (!session) {
    return { ok: false, response: authError(401) };
  }

  return {
    ok: true,
    auth: {
      userId: claims.sub,
      sessionId: claims.sid
    }
  };
}

