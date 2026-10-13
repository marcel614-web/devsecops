// apps/api/src/utils/logger.ts
import pino from "pino";
import { env, isDev, isTest } from "../config/env";
import { redact } from "./redact";

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  base: {
    service: "devsecops-api",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.privateKey",
      "*.secret",
      "*.clientSecret",
      "*.webhookSecret",
    ],
    censor: "[REDACTED]",
  },
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service,env",
          singleLine: false,
          // On désactive le formatage automatique des "objets error-like"
          // pour garder le contrôle total via notre redact() maison.
          errorLikeObjectKeys: [],
        },
      }
    : undefined,
});

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  logger.info(meta ? (redact(meta) as Record<string, unknown>) : {}, msg);
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  logger.warn(meta ? (redact(meta) as Record<string, unknown>) : {}, msg);
}

export function logError(
  msg: string,
  error?: unknown,
  meta?: Record<string, unknown>,
): void {
  const safeMeta = meta ? (redact(meta) as Record<string, unknown>) : {};
  if (error !== undefined) {
    // Clé volontairement NON réservée pour éviter le traitement automatique
    // de pino-pretty sur "err" / "error".
    safeMeta.errorInfo = redact(error);
  }
  logger.error(safeMeta, msg);
}

export function logDebug(msg: string, meta?: Record<string, unknown>): void {
  if (!isDev) return;
  logger.debug(meta ? (redact(meta) as Record<string, unknown>) : {}, msg);
}