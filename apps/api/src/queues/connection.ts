// apps/api/src/queues/connection.ts
import { Redis } from "ioredis";
import { env } from "../config/env";

/**
 * Connexion Redis partagée pour les Queues BullMQ.
 * BullMQ exige maxRetriesPerRequest = null.
 */
export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

// ioredis réessaie indéfiniment : on limite le bruit dans les logs
// (une erreur toutes les 30 s) tout en indiquant comment corriger.
let lastErrorAt = 0;

redisConnection.on("error", (err: NodeJS.ErrnoException) => {
  const now = Date.now();
  if (now - lastErrorAt < 30_000) return;
  lastErrorAt = now;

  // eslint-disable-next-line no-console
  console.error(
    `[redis] connexion à ${env.REDIS_HOST}:${env.REDIS_PORT} impossible ` +
      `(${err.code ?? err.message ?? "erreur inconnue"}). ` +
      "Démarrez Redis/Memurai ou lancez `npm run ensure:redis`.",
  );
});

redisConnection.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log(`[redis] connecté à ${env.REDIS_HOST}:${env.REDIS_PORT}`);
});
