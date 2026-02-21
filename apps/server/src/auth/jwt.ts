import { createHash } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { env } from "../config/env.ts";

type AccessTokenClaims = {
  sub: string;
  sid: string;
};

const JWT_SECRET_KEY = new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(claims: AccessTokenClaims) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + env.JWT_ACCESS_TTL_SEC;

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.sid)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(JWT_SECRET_KEY);

  return {
    token,
    expiresAt: expSec * 1000
  };
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, JWT_SECRET_KEY, {
    algorithms: ["HS256"]
  });

  if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    throw new Error("invalid token claims");
  }

  return {
    sub: payload.sub,
    sid: payload.jti,
    exp: typeof payload.exp === "number" ? payload.exp : undefined
  };
}

export function createRefreshToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

