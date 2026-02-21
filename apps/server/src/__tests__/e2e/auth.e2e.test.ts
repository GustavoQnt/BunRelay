import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate.ts";
import { db } from "../../db/index.ts";
import { users, rooms, roomMembers } from "../../db/schema.ts";
import { createServer } from "../../index.ts";
import { TestWSClient, login, setUrls } from "./helpers.ts";

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let wsUrl: string;

beforeAll(async () => {
  runMigrations();
  await seedTestData();
  server = createServer({ port: 0 });
  baseUrl = `http://${server.hostname}:${server.port}`;
  wsUrl = `ws://${server.hostname}:${server.port}`;
  setUrls(baseUrl, wsUrl);
});

afterAll(() => {
  server.stop(true);
});

async function seedTestData() {
  const now = Date.now();
  const passwordHash = await Bun.password.hash("password123", { algorithm: "bcrypt", cost: 4 });

  await db.insert(users).values([
    { id: "user_alice", username: "alice", displayName: "Alice", passwordHash, createdAt: now },
    { id: "user_bob", username: "bob", displayName: "Bob", passwordHash, createdAt: now }
  ]).onConflictDoNothing();

  await db.insert(rooms).values([
    { id: "room_general", name: "General", type: "group", createdAt: now }
  ]).onConflictDoNothing();

  await db.insert(roomMembers).values([
    { roomId: "room_general", userId: "user_alice", role: "member", joinedAt: now },
    { roomId: "room_general", userId: "user_bob", role: "member", joinedAt: now }
  ]).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// REST auth
// ---------------------------------------------------------------------------
describe("POST /auth/login", () => {
  it("returns tokens for valid credentials", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password123", deviceId: "web" })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.accessToken).toBeString();
    expect(body.refreshToken).toBeString();
    expect(body.user.id).toBe("user_alice");
  });

  it("returns 401 for wrong password (generic message)", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "wrongpassword", deviceId: "web" })
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.message).toBe("invalid credentials");
  });

  it("returns 401 for non-existent user (same message as wrong password)", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "password123", deviceId: "web" })
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.message).toBe("invalid credentials");
  });
});

describe("observability basics", () => {
  it("echoes x-request-id in HTTP responses", async () => {
    const reqId = "req_test_observability_1";
    const res = await fetch(`${baseUrl}/health`, {
      headers: {
        "x-request-id": reqId
      }
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(reqId);
  });

  it("exposes metrics snapshot", async () => {
    const res = await fetch(`${baseUrl}/ops/metrics`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(typeof body.uptimeSec).toBe("number");
    expect(typeof body.http.total).toBe("number");
    expect(typeof body.ws.messagesInTotal).toBe("number");
  });

  it("exposes prometheus metrics format", async () => {
    const res = await fetch(`${baseUrl}/ops/metrics.prom`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");

    const body = await res.text();
    expect(body).toContain("# HELP bunrelay_http_requests_total");
    expect(body).toContain("bunrelay_http_requests_total");
    expect(body).toContain("bunrelay_ws_connections_current");
  });
});

// ---------------------------------------------------------------------------
// WS auth handshake
// ---------------------------------------------------------------------------
describe("WS auth:hello", () => {
  it("returns auth:ok for valid token", async () => {
    const client = new TestWSClient();
    try {
      await client.connect(`${wsUrl}/ws`);
      const { accessToken } = await login("alice");
      client.send("auth:hello", { token: accessToken, deviceId: "d1" });
      const ev = await client.expect("auth:ok");
      expect((ev.data as any).userId).toBe("user_alice");
      expect((ev.data as any).deviceId).toBe("d1");
    } finally {
      client.close();
    }
  });

  it("returns auth:error for invalid token", async () => {
    const client = new TestWSClient();
    try {
      await client.connect(`${wsUrl}/ws`);
      client.send("auth:hello", { token: "bad.token.here", deviceId: "d1" });
      const ev = await client.expect("auth:error");
      expect((ev.data as any).code).toBe("UNAUTHORIZED");
    } finally {
      client.close();
    }
  });

  it("rejects room:join before auth with BAD_STATE", async () => {
    const client = new TestWSClient();
    try {
      await client.connect(`${wsUrl}/ws`);
      client.send("room:join", { roomId: "room_general" });
      const ev = await client.expect("error");
      expect((ev.data as any).code).toBe("BAD_STATE");
    } finally {
      client.close();
    }
  });

  it("rejects double auth:hello with BAD_STATE", async () => {
    const client = new TestWSClient();
    try {
      await client.connect(`${wsUrl}/ws`);
      const { accessToken } = await login("alice");
      client.send("auth:hello", { token: accessToken, deviceId: "d1" });
      await client.expect("auth:ok");
      // second auth
      client.send("auth:hello", { token: accessToken, deviceId: "d2" });
      const ev = await client.expect("error");
      expect((ev.data as any).code).toBe("BAD_STATE");
    } finally {
      client.close();
    }
  });

  it("disconnects after 5s auth timeout", async () => {
    const client = new TestWSClient();
    try {
      await client.connect(`${wsUrl}/ws`);
      // don't send auth:hello, wait for timeout
      await Bun.sleep(6000);
      expect(client.closed).toBe(true);
    } finally {
      client.close();
    }
  }, { timeout: 10000 });
});
