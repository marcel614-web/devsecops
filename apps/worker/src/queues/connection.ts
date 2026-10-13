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

redisConnection.on("error", (err) => {
  logger.error({ err: err.message }, "redis:error");
});

redisConnection.on("ready", () => {
  logger.info("Redis connecté");
});