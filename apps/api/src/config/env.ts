// apps/api/src/config/env.ts
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

function loadEnvFile(): void {
  const candidates: string[] = [];
  if (process.env.DEVSECOPS_ENV_FILE) {
    candidates.push(process.env.DEVSECOPS_ENV_FILE);
  }
  candidates.push(path.resolve(process.cwd(), "../../.env"));
  candidates.push(path.resolve(process.cwd(), ".env"));
  candidates.push(path.resolve(__dirname, "../../../../.env"));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
      return;
    }
  }
  console.warn("[api] Aucun fichier .env trouvé. Utilisation de process.env.");
}

loadEnvFile();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default("http://localhost:4000"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  BACKEND_URL: z.string().url().default("http://localhost:4000"),

  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  MASTER_ENCRYPTION_KEY: z.string().min(1),

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

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("Configuration invalide :\n" + issues);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";