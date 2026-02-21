import { and, eq, isNull } from "drizzle-orm";

import { db } from "./index.ts";
import { roomMembers, rooms, users } from "./schema.ts";

const seededUsers = [
  { id: "user_alice", username: "alice", displayName: "Alice" },
  { id: "user_bob", username: "bob", displayName: "Bob" },
  { id: "user_carlos", username: "carlos", displayName: "Carlos" },
  { id: "user_diana", username: "diana", displayName: "Diana" },
  { id: "user_erin", username: "erin", displayName: "Erin" }
] as const;

const seededRooms = [
  { id: "room_general", name: "General", type: "group" as const },
  { id: "room_random", name: "Random", type: "group" as const },
  { id: "room_alice_bob", name: null, type: "dm" as const }
] as const;

async function seedUsers() {
  const passwordHash = await Bun.password.hash("password123", { algorithm: "bcrypt", cost: 10 });
  const now = Date.now();

  for (const user of seededUsers) {
    await db
      .insert(users)
      .values({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        passwordHash,
        createdAt: now
      })
      .onConflictDoNothing();
  }
}

async function seedRoomsAndMembers() {
  const now = Date.now();

  for (const room of seededRooms) {
    await db
      .insert(rooms)
      .values({
        id: room.id,
        name: room.name,
        type: room.type,
        createdBy: room.type === "group" ? "user_alice" : null,
        createdAt: now
      })
      .onConflictDoNothing();
  }

  const memberships: [string, string, string][] = [
    ["room_general", "user_alice", "owner"],
    ["room_general", "user_bob", "member"],
    ["room_general", "user_carlos", "member"],
    ["room_general", "user_diana", "member"],
    ["room_general", "user_erin", "member"],
    ["room_random", "user_alice", "owner"],
    ["room_random", "user_bob", "member"],
    ["room_random", "user_carlos", "member"],
    ["room_alice_bob", "user_alice", "member"],
    ["room_alice_bob", "user_bob", "member"]
  ];

  for (const [roomId, userId, role] of memberships) {
    await db
      .insert(roomMembers)
      .values({
        roomId,
        userId,
        role,
        joinedAt: now
      })
      .onConflictDoNothing();
  }
}

async function assertSeeded() {
  const alice = await db.query.users.findFirst({
    where: eq(users.username, "alice")
  });

  const general = await db.query.rooms.findFirst({
    where: eq(rooms.id, "room_general")
  });

  const aliceMemberGeneral = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, "room_general"), eq(roomMembers.userId, "user_alice"))
  });

  if (!alice || !general || !aliceMemberGeneral) {
    throw new Error("seed failed");
  }

  const inactiveRooms = await db
    .select()
    .from(rooms)
    .where(isNull(rooms.createdAt))
    .limit(1);

  if (inactiveRooms.length > 0) {
    throw new Error("invalid room state");
  }
}

await seedUsers();
await seedRoomsAndMembers();
await assertSeeded();
console.log("seed completed. users password = password123");
