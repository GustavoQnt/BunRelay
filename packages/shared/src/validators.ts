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

