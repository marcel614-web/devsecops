// apps/api/src/config/env.schema.ts
import { z } from "zod";
import {
  MIN_SECRET_LENGTH,
  isPlaceholderSecret,
  secretField,
} from "@devsecops/shared";

/**
 * Schéma de configuration de l'API — SANS EFFET DE BORD.
 *
 * Ce module est volontairement séparé de `env.ts` qui, lui, charge le
 * `.env` et appelle `process.exit(1)` au moindre problème. Ici on n'a que
 * des fonctions pures : elles sont donc testables directement.
 *
 * La validation des secrets est mutualisée avec le worker via
 * `@devsecops/shared` : une seule implémentation, un seul jeu de tests.
 */

export { MIN_SECRET_LENGTH, isPlaceholderSecret, secretField };

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default("http://localhost:4000"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  BACKEND_URL: z.string().url().default("http://localhost:4000"),

  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),

  JWT_ACCESS_SECRET: secretField("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: secretField("JWT_REFRESH_SECRET"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  /**
   * Clé maîtresse de chiffrement (AES-256-GCM).
   * Elle dérive l'ensemble des secrets stockés en base : une clé faible ou
   * devinable compromet TOUTES les clés SSH, tokens GitHub et passphrases.
   * On exige donc une longueur réelle ET on refuse les placeholders.
   */
  MASTER_ENCRYPTION_KEY: secretField("MASTER_ENCRYPTION_KEY"),

  // ------------------------------------------------------------
  // GitHub App — TOUTES OPTIONNELLES
  // Elles seront lues depuis la base au premier usage.
  // On garde la possibilité de les définir en env pour des scripts
  // de bootstrap ou de CI.
  // ------------------------------------------------------------
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Valide un environnement brut.
 * @throws Error avec la liste des problèmes rencontrés.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  return parsed.data;
}
