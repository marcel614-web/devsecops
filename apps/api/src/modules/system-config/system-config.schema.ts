// apps/api/src/modules/system-config/system-config.schema.ts
import { z } from "zod";

export const updateGithubConfigSchema = z
  .object({
    appId: z.string().trim().min(1).max(50).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "Slug : minuscules, chiffres et tirets uniquement")
      .optional(),
    privateKey: z
      .string()
      .min(50)
      .refine(
        (v) => v.includes("-----BEGIN") && v.includes("PRIVATE KEY-----"),
        "Format PEM attendu (-----BEGIN ... PRIVATE KEY-----)",
      )
      .optional(),
    // Webhook secret OPTIONNEL (min 16 si fourni)
    webhookSecret: z
      .string()
      .trim()
      .min(16, "Au moins 16 caractères si fourni")
      .max(200)
      .optional(),
    clientId: z.string().trim().max(100).optional(),
    clientSecret: z.string().trim().max(200).optional(),
    markConfigured: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export const testGithubConfigSchema = z.object({
  appId: z.string().trim().min(1).max(50),
  privateKey: z
    .string()
    .min(50)
    .refine(
      (v) => v.includes("-----BEGIN") && v.includes("PRIVATE KEY-----"),
      "Format PEM attendu",
    ),
});

export type UpdateGithubConfigInput = z.infer<typeof updateGithubConfigSchema>;
export type TestGithubConfigInput = z.infer<typeof testGithubConfigSchema>;