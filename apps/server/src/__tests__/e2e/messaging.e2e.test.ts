import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { runMigrations } from "../../db/migrate.ts";
import { db } from "../../db/index.ts";
import { users, rooms, roomMembers } from "../../db/schema.ts";
import { createServer } from "../../index.ts";
import { authenticatedClient, joinedClient, setUrls, TestWSClient } from "./helpers.ts";

let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  runMigrations();
  await seedTestData();
  server = createServer({ port: 0 });
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const wsUrl = `ws://${server.hostname}:${server.port}`;
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
    { id: "user_bob", username: "bob", displayName: "Bob", passwordHash, createdAt: now },
    { id: "user_carlos", username: "carlos", displayName: "Carlos", passwordHash, createdAt: now }
  ]).onConflictDoNothing();

  await db.insert(rooms).values([
    { id: "room_general", name: "General", type: "group", createdAt: now },
    { id: "room_dm", name: null, type: "dm", createdAt: now }
  ]).onConflictDoNothing();

  await db.insert(roomMembers).values([
    { roomId: "room_general", userId: "user_alice", role: "member", joinedAt: now },
    { roomId: "room_general", userId: "user_bob", role: "member", joinedAt: now },
    { roomId: "room_general", userId: "user_carlos", role: "member", joinedAt: now },
    { roomId: "room_dm", userId: "user_alice", role: "member", joinedAt: now },
    { roomId: "room_dm", userId: "user_bob", role: "member", joinedAt: now }
  ]).onConflictDoNothing();
}

async function collectPresenceUpdates(client: TestWSClient, maxEvents = 8, timeoutMs = 300): Promise<any[]> {
  const updates: any[] = [];
  for (let i = 0; i < maxEvents; i++) {
    try {
      const ev = await client.expect("presence:update", timeoutMs);
      updates.push(ev);
    } catch {
      break;
    }
  }
  return updates;
}

// ---------------------------------------------------------------------------
// Happy path: multi-client send + receive
// ---------------------------------------------------------------------------
describe("msg:send happy path", () => {
  it("sender gets ack, receiver gets msg:new", async () => {
    const alice = await joinedClient("alice", "room_general");
    const bob = await joinedClient("bob", "room_general");

    const msgId = `msg_${nanoid(8)}`;
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "hello bob" });

    const ack = await alice.expect("msg:ack_server");
    expect((ack.data as any).messageId).toBe(msgId);

    const msg = await bob.expect("msg:new");
    expect((msg.data as any).messageId).toBe(msgId);
    expect((msg.data as any).content).toBe("hello bob");
    expect((msg.data as any).senderId).toBe("user_alice");

    alice.close();
    bob.close();
  });

  it("broadcasts to all room members", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-a1");
    const bob = await joinedClient("bob", "room_general", "dev-b1");
    const carlos = await joinedClient("carlos", "room_general", "dev-c1");

    const msgId = `msg_${nanoid(8)}`;
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "broadcast" });

    await alice.expect("msg:ack_server");
    const bobMsg = await bob.expect("msg:new");
    const carlosMsg = await carlos.expect("msg:new");

    expect((bobMsg.data as any).messageId).toBe(msgId);
    expect((carlosMsg.data as any).messageId).toBe(msgId);

    alice.close();
    bob.close();
    carlos.close();
  });

  it("supports unicode emoji payload end-to-end", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-a-emoji");
    const bob = await joinedClient("bob", "room_general", "dev-b-emoji");

    const msgId = `msg_emoji_${nanoid(8)}`;
    const content = "bom dia ☀️🚀🔥";
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content });

    await alice.expect("msg:ack_server");
    const msg = await bob.expect("msg:new");
    expect((msg.data as any).messageId).toBe(msgId);
    expect((msg.data as any).content).toBe(content);

    alice.close();
    bob.close();
  });
});

// ---------------------------------------------------------------------------
// Idempotency: duplicate messageId
// ---------------------------------------------------------------------------
describe("msg:send idempotency", () => {
  it("duplicate messageId returns ack but does not re-broadcast", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-a2");
    const bob = await joinedClient("bob", "room_general", "dev-b2");

    const msgId = `msg_idem_${nanoid(8)}`;

    // first send
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "first" });
    await alice.expect("msg:ack_server");
    await bob.expect("msg:new");

    // duplicate send
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "first" });
    const ack2 = await alice.expect("msg:ack_server");
    expect((ack2.data as any).messageId).toBe(msgId);

    // bob should NOT receive a second msg:new
    const noDuplicate = await bob.expectNoEvent("msg:new", 1000);
    expect(noDuplicate).toBe(true);

    alice.close();
    bob.close();
  });
});

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------
describe("reaction:set", () => {
  it("adds and removes reactions with room fanout", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-react-a1");
    const bob = await joinedClient("bob", "room_general", "dev-react-b1");

    const msgId = `msg_react_${nanoid(8)}`;
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "react here" });
    await alice.expect("msg:ack_server");
    await alice.expect("msg:new");
    await bob.expect("msg:new");

    bob.send("reaction:set", { roomId: "room_general", messageId: msgId, emoji: "🔥", active: true });
    const addForAlice = await alice.expect("reaction:update");
    const addForBob = await bob.expect("reaction:update");

    expect((addForAlice.data as any).messageId).toBe(msgId);
    expect((addForAlice.data as any).emoji).toBe("🔥");
    expect((addForAlice.data as any).active).toBe(true);
    expect((addForAlice.data as any).userId).toBe("user_bob");
    expect((addForBob.data as any).active).toBe(true);

    bob.send("reaction:set", { roomId: "room_general", messageId: msgId, emoji: "🔥", active: false });
    const removeForAlice = await alice.expect("reaction:update");
    const removeForBob = await bob.expect("reaction:update");
    expect((removeForAlice.data as any).active).toBe(false);
    expect((removeForBob.data as any).active).toBe(false);

    alice.close();
    bob.close();
  });

  it("is idempotent for duplicate active=true clicks", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-react-a2");
    const bob = await joinedClient("bob", "room_general", "dev-react-b2");

    const msgId = `msg_react_idem_${nanoid(8)}`;
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "idem" });
    await alice.expect("msg:ack_server");
    await alice.expect("msg:new");
    await bob.expect("msg:new");

    bob.send("reaction:set", { roomId: "room_general", messageId: msgId, emoji: "👍", active: true });
    await alice.expect("reaction:update");
    await bob.expect("reaction:update");

    bob.send("reaction:set", { roomId: "room_general", messageId: msgId, emoji: "👍", active: true });
    const noDuplicateForAlice = await alice.expectNoEvent("reaction:update", 1000);
    const noDuplicateForBob = await bob.expectNoEvent("reaction:update", 1000);
    expect(noDuplicateForAlice).toBe(true);
    expect(noDuplicateForBob).toBe(true);

    alice.close();
    bob.close();
  });
});

// ---------------------------------------------------------------------------
// State machine: msg:send before room:join
// ---------------------------------------------------------------------------
describe("state machine", () => {
  it("msg:send before room:join returns BAD_STATE", async () => {
    const alice = await authenticatedClient("alice", "dev-a3");

    alice.send("msg:send", { roomId: "room_general", messageId: "nope", content: "fail" });
    const err = await alice.expect("error");
    expect((err.data as any).code).toBe("BAD_STATE");

    alice.close();
  });

  it("room:join to non-existent room returns NOT_FOUND", async () => {
    const alice = await authenticatedClient("alice", "dev-a4");

    alice.send("room:join", { roomId: "room_nonexistent" });
    const err = await alice.expect("error");
    expect((err.data as any).code).toBe("NOT_FOUND");

    alice.close();
  });

  it("room:join when not a member returns FORBIDDEN", async () => {
    const carlos = await authenticatedClient("carlos", "dev-c2");

    carlos.send("room:join", { roomId: "room_dm" }); // carlos not in DM
    const err = await carlos.expect("error");
    expect((err.data as any).code).toBe("FORBIDDEN");

    carlos.close();
  });
});

// ---------------------------------------------------------------------------
// room:snapshot catch-up with cursor
// ---------------------------------------------------------------------------
describe("catch-up on room:join with cursor", () => {
  it("returns only messages after cursor", async () => {
    // alice sends two messages
    const alice = await joinedClient("alice", "room_general", "dev-a5");

    const msg1 = `msg_catchup1_${nanoid(8)}`;
    const msg2 = `msg_catchup2_${nanoid(8)}`;

    alice.send("msg:send", { roomId: "room_general", messageId: msg1, content: "first" });
    await alice.expect("msg:ack_server");
    const newMsg1 = await alice.expect("msg:new");
    const cursor1 = { ts: (newMsg1.data as any).ts, messageId: msg1 };

    alice.send("msg:send", { roomId: "room_general", messageId: msg2, content: "second" });
    await alice.expect("msg:ack_server");
    alice.close();

    // bob joins with cursor after msg1 — should only get msg2
    const bob = await authenticatedClient("bob", "dev-b5");
    bob.send("room:join", { roomId: "room_general", cursor: cursor1 });
    const snapshot = await bob.expect("room:snapshot");
    const msgs = (snapshot.data as any).messages as any[];
    const ids = msgs.map((m: any) => m.messageId);

    expect(ids).toContain(msg2);
    expect(ids).not.toContain(msg1);

    bob.close();
  });
});

// ---------------------------------------------------------------------------
// Delivery receipts
// ---------------------------------------------------------------------------
describe("msg:delivered", () => {
  it("bob confirms delivery, alice receives receipt", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-a6");
    const bob = await joinedClient("bob", "room_general", "dev-b6");

    const msgId = `msg_del_${nanoid(8)}`;
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "ack me" });
    await alice.expect("msg:ack_server");
    await bob.expect("msg:new");

    bob.send("msg:delivered", { roomId: "room_general", messageId: msgId });
    const receipt = await alice.expect("msg:delivered");
    expect((receipt.data as any).messageId).toBe(msgId);
    expect((receipt.data as any).userId).toBe("user_bob");

    alice.close();
    bob.close();
  });
});

// ---------------------------------------------------------------------------
// Read cursors
// ---------------------------------------------------------------------------
describe("msg:read", () => {
  it("bob marks as read, alice receives read receipt", async () => {
    const alice = await joinedClient("alice", "room_general", "dev-a7");
    const bob = await joinedClient("bob", "room_general", "dev-b7");

    const msgId = `msg_read_${nanoid(8)}`;
    alice.send("msg:send", { roomId: "room_general", messageId: msgId, content: "read me" });
    await alice.expect("msg:ack_server");
    const newMsg = await bob.expect("msg:new");
    const ts = (newMsg.data as any).ts;

    bob.send("msg:read", { roomId: "room_general", cursor: { ts, messageId: msgId } });
    const readEvt = await alice.expect("msg:read");
    expect((readEvt.data as any).userId).toBe("user_bob");
    expect((readEvt.data as any).cursor.messageId).toBe(msgId);

    alice.close();
    bob.close();
  });
});

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------
describe("typing:set", () => {
  it("broadcasts typing:update to room members", async () => {
    const alice = await joinedClient("alice", "room_dm", "dev-a8");
    const bob = await joinedClient("bob", "room_dm", "dev-b8");

    alice.send("typing:set", { roomId: "room_dm", isTyping: true });
    const ev = await bob.expect("typing:update");
    expect((ev.data as any).isTyping).toBe(true);
    expect((ev.data as any).userId).toBe("user_alice");

    alice.send("typing:set", { roomId: "room_dm", isTyping: false });
    const ev2 = await bob.expect("typing:update");
    expect((ev2.data as any).isTyping).toBe(false);

    alice.close();
    bob.close();
  });
});

// ---------------------------------------------------------------------------
// Presence scoping
// ---------------------------------------------------------------------------
describe("presence policy (room-scoped)", () => {
  it("sends member presence snapshot on room:join", async () => {
    const alice = await joinedClient("alice", "room_dm", "dev-pres-a1");
    const bob = await authenticatedClient("bob", "dev-pres-b1");

    await collectPresenceUpdates(alice);

    bob.send("room:join", { roomId: "room_dm" });
    await bob.expect("room:snapshot");

    const updates = await collectPresenceUpdates(bob);
    const alicePresence = updates.find(
      (ev) => (ev.data as any).userId === "user_alice" && (ev.data as any).status === "online"
    );

    expect(Boolean(alicePresence)).toBe(true);

    alice.close();
    bob.close();
  });

  it("does not leak presence updates to sockets outside the joined room", async () => {
    const alice = await joinedClient("alice", "room_dm", "dev-pres-a2");
    const carlos = await joinedClient("carlos", "room_general", "dev-pres-c2");
    const bob = await authenticatedClient("bob", "dev-pres-b2");

    await collectPresenceUpdates(alice);
    await collectPresenceUpdates(carlos);

    bob.send("room:join", { roomId: "room_dm" });
    await bob.expect("room:snapshot");

    const aliceUpdates = await collectPresenceUpdates(alice);
    const bobOnlineForAlice = aliceUpdates.find(
      (ev) => (ev.data as any).userId === "user_bob" && (ev.data as any).status === "online"
    );
    expect(Boolean(bobOnlineForAlice)).toBe(true);

    const noLeakToCarlos = await carlos.expectNoEvent("presence:update", 800);
    expect(noLeakToCarlos).toBe(true);

    alice.close();
    bob.close();
    carlos.close();
  });
});
