// apps/api/src/modules/servers/servers.schema.ts
import { z } from "zod";
import { ServerAuthType } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const serverIdParamSchema = z.object({
  id: z.string().min(1),
});

export const serverListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().min(1).max(100).optional(),
});

const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(
    /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/,
    "Host invalide (IP ou hostname attendu)",
  );

const nameSchema = z.string().trim().min(1).max(80);

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z_][a-z0-9_-]*$/, "Nom d'utilisateur Unix attendu (a-z, _, -)");

const privateKeySchema = z
  .string()
  .min(100, "Clé privée SSH trop courte")
  .max(20000)
  .refine(
    (v) =>
      v.includes("-----BEGIN") &&
      v.includes("PRIVATE KEY-----") &&
      v.includes("-----END"),
    "Format PEM attendu (-----BEGIN ... PRIVATE KEY-----)",
  );

const hostKeyFingerprintSchema = z
  .string()
  .trim()
  .regex(
    /^SHA256:[A-Za-z0-9+/]{43}$/,
    "Empreinte attendue au format OpenSSH SHA256:<base64 sans padding>",
  );

export const trustHostKeySchema = z.object({
  fingerprint: hostKeyFingerprintSchema,
  algorithm: z.string().trim().min(1).max(64).optional(),
  /// Double confirmation explicite : l'empreinte doit être vérifiée hors bande.
  confirm: z.literal(true, {
    errorMap: () => ({
      message: "Confirmation explicite requise pour enregistrer la clé d'hôte",
    }),
  }),
});

export type TrustHostKeyInput = z.infer<typeof trustHostKeySchema>;

export const createServerSchema = z
  .object({
    name: nameSchema,
    host: hostSchema,
    sshPort: z.coerce.number().int().min(1).max(65535).default(22),
    username: usernameSchema.default("deploy"),
    authType: z.nativeEnum(ServerAuthType).default(ServerAuthType.SSH_KEY),
    privateKey: privateKeySchema.optional(),
    passphrase: z.string().min(1).max(256).optional(),
    hostKeyFingerprint: hostKeyFingerprintSchema.optional(),
    hostKeyAlgorithm: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (d) => d.authType !== ServerAuthType.SSH_KEY || !!d.privateKey,
    { message: "Clé privée requise pour authType=SSH_KEY", path: ["privateKey"] },
  );

export const updateServerSchema = z
  .object({
    name: nameSchema.optional(),
    host: hostSchema.optional(),
    sshPort: z.coerce.number().int().min(1).max(65535).optional(),
    username: usernameSchema.optional(),
    privateKey: privateKeySchema.optional(),
    passphrase: z.string().min(1).max(256).optional(),
    hostKeyFingerprint: hostKeyFingerprintSchema.optional(),
    hostKeyAlgorithm: z.string().trim().min(1).max(64).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export type CreateServerInput = z.infer<typeof createServerSchema>;
export type UpdateServerInput = z.infer<typeof updateServerSchema>;
export type ServerListQuery = z.infer<typeof serverListQuerySchema>;