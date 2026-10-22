// apps/worker/src/config/env.ts
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";
import { secretField } from "@devsecops/shared";

/**
 * Charge le premier .env trouvé parmi les chemins candidats.
 * Ordre :
 *  1. DEVSECOPS_ENV_FILE (variable explicite)
 *  2. Racine du monorepo (devsecops-platform/.env)
 *  3. Dossier courant (process.cwd()/.env)
 *  4. Dossier apps/worker/.env
 */
function loadEnvFile(): void {
  const candidates: string[] = [];

  if (process.env.DEVSECOPS_ENV_FILE) {
    candidates.push(process.env.DEVSECOPS_ENV_FILE);
  }

  // process.cwd() = apps/worker quand on lance `npm run dev` là-bas.
  candidates.push(path.resolve(process.cwd(), "../../.env")); // racine monorepo
  candidates.push(path.resolve(process.cwd(), ".env")); // apps/worker
  candidates.push(path.resolve(__dirname, "../../../../.env")); // fallback

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
      return;
    }
  }

  console.warn("[worker] Aucun fichier .env trouvé. Utilisation de process.env.");
}

loadEnvFile();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().min(1),

  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),

  MASTER_ENCRYPTION_KEY: secretField("MASTER_ENCRYPTION_KEY"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error("[worker] Configuration invalide :\n" + issues);
  process.exit(1);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";