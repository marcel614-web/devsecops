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

redisConnection.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[redis] erreur de connexion", err.message);
});