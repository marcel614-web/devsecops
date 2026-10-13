// apps/worker/src/utils/logger.ts
import pino from "pino";
import { env, isDev } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "devsecops-worker",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.privateKey",
      "*.secret",
      "*.passphrase",
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
        },
      }
    : undefined,
});