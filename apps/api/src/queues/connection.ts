// apps/api/src/queues/connection.ts
import { Redis } from "ioredis";
import { env, isTest } from "../config/env";

/**
 * Connexion Redis partagée pour les Queues BullMQ.
 * BullMQ exige maxRetriesPerRequest = null.
 *
 * En mode test, la connexion est LAZY et ne réessaie pas indéfiniment :
 * la majorité des tests d'API n'a pas besoin de Redis, et une boucle de
 * reconnexion infinie ralentissait l'import des modules de test.
 */
export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: isTest,
  ...(isTest
    ? {
        // En test on n'insiste pas : une seule tentative, puis on rend la main.
        retryStrategy: () => null,
      }
    : {}),
});

// ioredis réessaie indéfiniment : on limite le bruit dans les logs
// (une erreur toutes les 30 s) tout en indiquant comment corriger.
let lastErrorAt = 0;

redisConnection.on("error", (err: NodeJS.ErrnoException) => {
  if (isTest) return;

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
  if (isTest) return;
  // eslint-disable-next-line no-console
  console.log(`[redis] connecté à ${env.REDIS_HOST}:${env.REDIS_PORT}`);
});
