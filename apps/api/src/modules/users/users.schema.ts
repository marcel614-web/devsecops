// apps/api/src/modules/users/users.schema.ts
import { z } from "zod";
import { Role } from "@prisma/client";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../../config/constants";

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  role: z.nativeEnum(Role).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  isActive: z
    .union([z.boolean(), z.string()])
    .transform((v) => {
      if (typeof v === "boolean") return v;
      return v === "true";
    })
    .optional(),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
  name: z
    .string()
    .trim()
    .min(NAME_MIN_LENGTH)
    .max(NAME_MAX_LENGTH),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .regex(/[A-Z]/, "Une majuscule est requise")
    .regex(/[a-z]/, "Une minuscule est requise")
    .regex(/[0-9]/, "Un chiffre est requis")
    .regex(/[^A-Za-z0-9]/, "Un caractère spécial est requis"),
  role: z.nativeEnum(Role).default(Role.DEVELOPER),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export const userIdParamSchema = z.object({
  id: z.string().min(1),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;