// apps/worker/src/utils/prisma.ts
import { PrismaClient } from "@prisma/client";
import { isDev } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var __workerPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });
}

export const prisma: PrismaClient =
  globalThis.__workerPrisma ?? createPrismaClient();

if (isDev) {
  globalThis.__workerPrisma = prisma;
}