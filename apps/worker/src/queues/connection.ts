// apps/worker/src/queues/connection.ts
import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Connexion Redis partagée. BullMQ exige maxRetriesPerRequest=null.
 */
export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ioredis réessaie indéfiniment : on limite le bruit dans les logs
// (une erreur toutes les 30 s) tout en indiquant comment corriger.
let lastErrorAt = 0;

redisConnection.on("error", (err: NodeJS.ErrnoException) => {
  const now = Date.now();
  if (now - lastErrorAt < 30_000) return;
  lastErrorAt = now;

  logger.error(
    {
      code: err.code ?? "inconnu",
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
    "redis:connexion impossible — démarrez Redis/Memurai (npm run ensure:redis)",
  );
});

redisConnection.on("ready", () => {
  logger.info("Redis connecté");
});
