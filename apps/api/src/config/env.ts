// apps/api/src/config/env.ts
import "dotenv/config";
import { z } from "zod";

/**
 * Schema de validation des variables d'environnement.
 * Toute variable absente ou invalide fait planter le démarrage.
 * On ne met JAMAIS de valeur par défaut sur un secret.
 */
const EnvSchema = z.object({
  // Runtime
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default("http://localhost:4000"),

  // Base de données
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),

  // Redis
  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET doit faire au moins 32 caractères"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET doit faire au moins 32 caractères"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  // Argon2id
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  // Chiffrement des secrets (clé maître base64, 32 octets)
  MASTER_ENCRYPTION_KEY: z
    .string()
    .min(1, "MASTER_ENCRYPTION_KEY est requis"),

  // GitHub
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID est requis"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET est requis"),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET est requis"),
  GITHUB_CALLBACK_URL: z.string().url().default("http://localhost:4000/api/github/callback"),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validation immédiate au chargement du module.
 * Si une variable est manquante, on affiche clairement laquelle et on quitte.
 */
function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    // Pas de Pino ici : il n'est pas encore chargé, on utilise console.
    console.error("Configuration invalide :\n" + issues);
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * Drapeaux dérivés pratiques.
 */
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";