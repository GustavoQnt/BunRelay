import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createServer } from "../../index.ts";
import { db } from "../../db/index.ts";
import { runMigrations } from "../../db/migrate.ts";
import { roomMembers, rooms, users } from "../../db/schema.ts";
import { login, setUrls } from "./helpers.ts";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

const runId = Date.now().toString(36);
const newPeerId = `user_peer_${runId}`;
const newPeerUsername = `peer_${runId}`;

beforeAll(async () => {
  await runMigrations();
  await seedTestData();
  server = createServer({ port: 0 });
  baseUrl = `http://${server.hostname}:${server.port}`;
  const wsUrl = `ws://${server.hostname}:${server.port}`;
  setUrls(baseUrl, wsUrl);
});

afterAll(() => {
  server.stop(true);
});

async function seedTestData() {
  const now = Date.now();
  const passwordHash = await Bun.password.hash("password123", { algorithm: "bcrypt", cost: 4 });

  await db
    .insert(users)
    .values([
      { id: "user_alice", username: "alice", displayName: "Alice", passwordHash, createdAt: now },
      { id: "user_bob", username: "bob", displayName: "Bob", passwordHash, createdAt: now },
      { id: "user_carlos", username: "carlos", displayName: "Carlos", passwordHash, createdAt: now },
      { id: newPeerId, username: newPeerUsername, displayName: "Peer", passwordHash, createdAt: now }
    ])
    .onConflictDoNothing();

  await db
    .insert(rooms)
    .values([{ id: "room_seed_dm_alice_bob", name: null, type: "dm", createdAt: now }])
    .onConflictDoNothing();

  await db
    .insert(roomMembers)
    .values([
      { roomId: "room_seed_dm_alice_bob", userId: "user_alice", role: "member", joinedAt: now },
      { roomId: "room_seed_dm_alice_bob", userId: "user_bob", role: "member", joinedAt: now }
    ])
    .onConflictDoNothing();
}

async function authHeaders(username: string) {
  const { accessToken } = await login(username);
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
}

describe("POST /rooms/dm", () => {
  it("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/rooms/dm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerUserId: "user_bob" })
    });

    expect(res.status).toBe(401);
  });

  it("is idempotent for existing DM pair", async () => {
    const res = await fetch(`${baseUrl}/rooms/dm`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({ peerUserId: "user_bob" })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(false);
    expect(body.room.type).toBe("dm");

    const members = await db
      .select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, body.room.id));

    expect(members.length).toBe(2);
    expect(members.some((member: any) => member.userId === "user_alice")).toBe(true);
    expect(members.some((member: any) => member.userId === "user_bob")).toBe(true);
  });

  it("creates a new DM when pair does not exist", async () => {
    const res = await fetch(`${baseUrl}/rooms/dm`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({ peerUserId: newPeerId })
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.created).toBe(true);
    expect(body.room.type).toBe("dm");

    const aliceMembership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, body.room.id), eq(roomMembers.userId, "user_alice"))
    });
    const peerMembership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, body.room.id), eq(roomMembers.userId, newPeerId))
    });

    expect(Boolean(aliceMembership)).toBe(true);
    expect(Boolean(peerMembership)).toBe(true);
  });

  it("rejects creating DM with self", async () => {
    const res = await fetch(`${baseUrl}/rooms/dm`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({ peerUserId: "user_alice" })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 when peer does not exist", async () => {
    const res = await fetch(`${baseUrl}/rooms/dm`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({ peerUserId: "user_missing" })
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /rooms/groups", () => {
  it("creates group and adds creator as owner", async () => {
    const res = await fetch(`${baseUrl}/rooms/groups`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({
        name: "Project Ops",
        memberIds: ["user_bob", "user_carlos", "user_bob", "user_alice"]
      })
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.created).toBe(true);
    expect(body.room.type).toBe("group");
    expect(body.room.name).toBe("Project Ops");
    expect(body.memberIds).toContain("user_alice");
    expect(body.memberIds).toContain("user_bob");
    expect(body.memberIds).toContain("user_carlos");

    const creatorMembership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, body.room.id), eq(roomMembers.userId, "user_alice"))
    });

    expect(creatorMembership?.role).toBe("owner");
  });

  it("returns 400 when only self remains after normalization", async () => {
    const res = await fetch(`${baseUrl}/rooms/groups`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({
        name: "Solo",
        memberIds: ["user_alice", "user_alice"]
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 when one or more members do not exist", async () => {
    const res = await fetch(`${baseUrl}/rooms/groups`, {
      method: "POST",
      headers: await authHeaders("alice"),
      body: JSON.stringify({
        name: "Broken Group",
        memberIds: ["user_bob", "user_not_found"]
      })
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.missingUserIds).toContain("user_not_found");
  });
});
