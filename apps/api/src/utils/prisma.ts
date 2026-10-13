// apps/api/src/utils/prisma.ts
import { PrismaClient } from "@prisma/client";
import { isDev, isTest } from "../config/env";
import { logger } from "./logger";

/**
 * Instance unique de PrismaClient.
 * En développement, on stocke l'instance dans globalThis pour éviter
 * les rechargements à chaud de tsx/vite qui recréent le client.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: isDev
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ]
      : [
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ],
  });

  // Les requêtes SQL sont loguées uniquement en dev, jamais en prod.
  if (isDev && !isTest) {
    client.$on("query", (e) => {
      logger.debug(
        {
          durationMs: e.duration,
          query: e.query,
          // Les params peuvent contenir des secrets → on les masque via redact
          // (le logger applique déjà redact, ici on évite juste de les exposer).
        },
        "prisma:query",
      );
    });
  }

  client.$on("warn", (e) => {
    logger.warn({ target: e.target }, "prisma:warn");
  });

  client.$on("error", (e) => {
    logger.error({ target: e.target }, "prisma:error");
  });

  return client;
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

if (isDev) {
  globalThis.__prisma = prisma;
}