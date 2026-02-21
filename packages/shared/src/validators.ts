import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_]+$/i);

export const passwordSchema = z.string().min(6).max(128);

export const loginBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  deviceId: z.string().trim().min(1).max(128).optional()
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1)
});

const userIdSchema = z.string().trim().min(1).max(128);

export const createDmBodySchema = z.object({
  peerUserId: userIdSchema
});

export const createGroupBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  memberIds: z.array(userIdSchema).min(1).max(100)
});

export const addRoomMemberBodySchema = z.object({
  userId: userIdSchema
});

export const updateRoomMemberRoleBodySchema = z.object({
  role: z.enum(["member", "admin"])
});

export const transferOwnershipBodySchema = z.object({
  userId: z.string().trim().min(1).max(128)
});
