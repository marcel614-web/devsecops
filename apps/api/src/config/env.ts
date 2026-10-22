// apps/api/src/config/env.ts
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { EnvSchema, parseEnv, type Env } from "./env.schema";

export type { Env };
export { EnvSchema, parseEnv, isPlaceholderSecret } from "./env.schema";

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

function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (err) {
    console.error(
      err instanceof Error ? err.message : "Configuration invalide",
    );
    process.exit(1);
  }
}

export const env: Env = loadEnv();
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
