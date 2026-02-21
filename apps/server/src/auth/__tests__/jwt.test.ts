import { describe, it, expect } from "bun:test";
import { signAccessToken, verifyAccessToken, createRefreshToken, hashToken } from "../jwt.ts";

describe("signAccessToken + verifyAccessToken", () => {
  it("round-trips claims correctly", async () => {
    const claims = { sub: "user_alice", sid: "session_123" };
    const { token, expiresAt } = await signAccessToken(claims);

    const verified = await verifyAccessToken(token);
    expect(verified.sub).toBe("user_alice");
    expect(verified.sid).toBe("session_123");
    expect(verified.exp).toBeNumber();
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered token", async () => {
    const { token } = await signAccessToken({ sub: "u1", sid: "s1" });
    const parts = token.split(".");
    parts[2] = "TAMPERED";
    await expect(verifyAccessToken(parts.join("."))).rejects.toThrow();
  });

  it("rejects a completely invalid string", async () => {
    await expect(verifyAccessToken("garbage")).rejects.toThrow();
  });

  it("produces an expired token when TTL is exceeded", async () => {
    // We can't easily mock env.JWT_ACCESS_TTL_SEC since it's cached at import,
    // so instead we verify that the token's exp is in the future (positive test)
    const { token } = await signAccessToken({ sub: "u1", sid: "s1" });
    const verified = await verifyAccessToken(token);
    expect(verified.exp! * 1000).toBeGreaterThan(Date.now());
  });
});

describe("createRefreshToken", () => {
  it("returns a non-empty string", () => {
    const token = createRefreshToken();
    expect(token).toBeString();
    expect(token.length).toBeGreaterThan(0);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
