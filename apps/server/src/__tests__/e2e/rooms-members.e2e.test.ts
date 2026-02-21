import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createServer } from "../../index.ts";
import { db } from "../../db/index.ts";
import { runMigrations } from "../../db/migrate.ts";
import { roomMembers, rooms, users } from "../../db/schema.ts";
import { authenticatedClient, joinedClient, login, setUrls } from "./helpers.ts";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

const runId = Date.now().toString(36);
const userAdmin = { id: `user_admin_${runId}`, username: `admin_${runId}` };
const userBob = { id: `user_bob_${runId}`, username: `bob_${runId}` };
const userCarlos = { id: `user_carlos_${runId}`, username: `carlos_${runId}` };
const userDiana = { id: `user_diana_${runId}`, username: `diana_${runId}` };

const groupRoomId = `room_group_members_${runId}`;
const groupSingleAdminRoomId = `room_group_single_admin_${runId}`;
const dmRoomId = `room_dm_members_${runId}`;

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
      {
        id: userAdmin.id,
        username: userAdmin.username,
        displayName: "Admin User",
        passwordHash,
        createdAt: now
      },
      {
        id: userBob.id,
        username: userBob.username,
        displayName: "Bob User",
        passwordHash,
        createdAt: now
      },
      {
        id: userCarlos.id,
        username: userCarlos.username,
        displayName: "Carlos User",
        passwordHash,
        createdAt: now
      },
      {
        id: userDiana.id,
        username: userDiana.username,
        displayName: "Diana User",
        passwordHash,
        createdAt: now
      }
    ])
    .onConflictDoNothing();

  await db
    .insert(rooms)
    .values([
      { id: groupRoomId, name: "Group Members", type: "group", createdAt: now },
      { id: groupSingleAdminRoomId, name: "Group Single Admin", type: "group", createdAt: now },
      { id: dmRoomId, name: null, type: "dm", createdAt: now }
    ])
    .onConflictDoNothing();

  await db
    .insert(roomMembers)
    .values([
      { roomId: groupRoomId, userId: userAdmin.id, role: "admin", joinedAt: now },
      { roomId: groupRoomId, userId: userBob.id, role: "member", joinedAt: now },
      { roomId: groupRoomId, userId: userCarlos.id, role: "admin", joinedAt: now },
      { roomId: groupSingleAdminRoomId, userId: userAdmin.id, role: "admin", joinedAt: now },
      { roomId: groupSingleAdminRoomId, userId: userBob.id, role: "member", joinedAt: now },
      { roomId: dmRoomId, userId: userAdmin.id, role: "member", joinedAt: now },
      { roomId: dmRoomId, userId: userBob.id, role: "member", joinedAt: now }
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

describe("GET /rooms/:id/members", () => {
  it("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when requester is not a room member", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
      headers: await authHeaders(userDiana.username)
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns room members with roles for members of the room", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
      headers: await authHeaders(userAdmin.username)
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.roomId).toBe(groupRoomId);
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.some((m: any) => m.userId === userAdmin.id && m.role === "admin")).toBe(true);
    expect(body.members.some((m: any) => m.userId === userBob.id && m.role === "member")).toBe(true);
  });
});

describe("POST /rooms/:id/members", () => {
  it("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userDiana.id })
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when requester is not admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
      method: "POST",
      headers: await authHeaders(userBob.username),
      body: JSON.stringify({ userId: userDiana.id })
    });

    expect(res.status).toBe(403);
  });

  it("adds member when requester is admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
      method: "POST",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ userId: userDiana.id })
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.added).toBe(true);

    const membership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, groupRoomId), eq(roomMembers.userId, userDiana.id))
    });

    expect(membership?.role).toBe("member");
  });

  it("is idempotent for already-member user", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
      method: "POST",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ userId: userDiana.id })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.added).toBe(false);
  });

  it("returns 400 when room is not group", async () => {
    const res = await fetch(`${baseUrl}/rooms/${dmRoomId}/members`, {
      method: "POST",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ userId: userDiana.id })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

describe("DELETE /rooms/:id/members/:userId", () => {
  it("returns 403 when requester is not admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userDiana.id}`, {
      method: "DELETE",
      headers: await authHeaders(userBob.username)
    });

    expect(res.status).toBe(403);
  });

  it("removes existing member when requester is admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userDiana.id}`, {
      method: "DELETE",
      headers: await authHeaders(userAdmin.username)
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.removed).toBe(true);

    const membership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, groupRoomId), eq(roomMembers.userId, userDiana.id))
    });
    expect(membership).toBeUndefined();
  });

  it("returns removed=false for non-member user", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/user_missing_${runId}`, {
      method: "DELETE",
      headers: await authHeaders(userAdmin.username)
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.removed).toBe(false);
  });

  it("does not allow removing last admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupSingleAdminRoomId}/members/${userAdmin.id}`, {
      method: "DELETE",
      headers: await authHeaders(userAdmin.username)
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

describe("PATCH /rooms/:id/members/:userId/role", () => {
  it("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userBob.id}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" })
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when requester is not admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userBob.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userDiana.username),
      body: JSON.stringify({ role: "admin" })
    });

    expect(res.status).toBe(403);
  });

  it("promotes member to admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userBob.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ role: "admin" })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.changed).toBe(true);
    expect(body.role).toBe("admin");

    const updatedMembership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, groupRoomId), eq(roomMembers.userId, userBob.id))
    });
    expect(updatedMembership?.role).toBe("admin");
  });

  it("is idempotent when role is unchanged", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userBob.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ role: "admin" })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.changed).toBe(false);
  });

  it("demotes admin to member when there is another admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userCarlos.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ role: "member" })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.changed).toBe(true);
    expect(body.role).toBe("member");

    const updatedMembership = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, groupRoomId), eq(roomMembers.userId, userCarlos.id))
    });
    expect(updatedMembership?.role).toBe("member");
  });

  it("returns 404 when target member does not exist in room", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userDiana.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ role: "member" })
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("does not allow demoting last admin", async () => {
    const res = await fetch(`${baseUrl}/rooms/${groupSingleAdminRoomId}/members/${userAdmin.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ role: "member" })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 when room is not group", async () => {
    const res = await fetch(`${baseUrl}/rooms/${dmRoomId}/members/${userBob.id}/role`, {
      method: "PATCH",
      headers: await authHeaders(userAdmin.username),
      body: JSON.stringify({ role: "admin" })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

describe("WS room:member:update broadcasts", () => {
  it("emits update events for add/remove/role changes", async () => {
    const adminWs = await joinedClient(userAdmin.username, groupRoomId, `ws-admin-${runId}`);
    const bobWs = await joinedClient(userBob.username, groupRoomId, `ws-bob-${runId}`);
    const dianaWs = await authenticatedClient(userDiana.username, `ws-diana-${runId}`);

    try {
      const addRes = await fetch(`${baseUrl}/rooms/${groupRoomId}/members`, {
        method: "POST",
        headers: await authHeaders(userAdmin.username),
        body: JSON.stringify({ userId: userDiana.id })
      });
      expect(addRes.status).toBe(201);

      const addAdminEvent = await adminWs.expect("room:member:update");
      const addBobEvent = await bobWs.expect("room:member:update");
      const addDianaEvent = await dianaWs.expect("room:member:update");

      expect((addAdminEvent.data as any).action).toBe("added");
      expect((addBobEvent.data as any).action).toBe("added");
      expect((addDianaEvent.data as any).action).toBe("added");
      expect((addDianaEvent.data as any).userId).toBe(userDiana.id);

      const roleRes = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userBob.id}/role`, {
        method: "PATCH",
        headers: await authHeaders(userAdmin.username),
        body: JSON.stringify({ role: "member" })
      });
      expect(roleRes.status).toBe(200);

      const roleAdminEvent = await adminWs.expect("room:member:update");
      const roleBobEvent = await bobWs.expect("room:member:update");
      const roleDianaEvent = await dianaWs.expect("room:member:update");

      expect((roleAdminEvent.data as any).action).toBe("role_updated");
      expect((roleAdminEvent.data as any).role).toBe("member");
      expect((roleBobEvent.data as any).action).toBe("role_updated");
      expect((roleDianaEvent.data as any).action).toBe("role_updated");

      const removeRes = await fetch(`${baseUrl}/rooms/${groupRoomId}/members/${userDiana.id}`, {
        method: "DELETE",
        headers: await authHeaders(userAdmin.username)
      });
      expect(removeRes.status).toBe(200);

      const removeAdminEvent = await adminWs.expect("room:member:update");
      const removeDianaEvent = await dianaWs.expect("room:member:update");

      expect((removeAdminEvent.data as any).action).toBe("removed");
      expect((removeAdminEvent.data as any).userId).toBe(userDiana.id);
      expect((removeDianaEvent.data as any).action).toBe("removed");
    } finally {
      adminWs.close();
      bobWs.close();
      dianaWs.close();
    }
  });
});
