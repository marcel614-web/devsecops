// apps/api/src/middleware/rateLimiter.ts
import rateLimit from "express-rate-limit";
import {
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_GLOBAL_WINDOW_MS,
  RATE_LIMIT_WEBHOOK_MAX,
  RATE_LIMIT_WEBHOOK_WINDOW_MS,
} from "../config/constants";
import { isTest } from "../config/env";

const commonOptions = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  // En test, on désactive complètement le rate limiting.
  skip: () => isTest,
};

export const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: RATE_LIMIT_GLOBAL_WINDOW_MS,
  max: RATE_LIMIT_GLOBAL_MAX,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Trop de requêtes, veuillez réessayer plus tard",
    },
  },
});

export const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
  max: RATE_LIMIT_AUTH_MAX,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Trop de tentatives d'authentification, réessayez plus tard",
    },
  },
});

export const webhookLimiter = rateLimit({
  ...commonOptions,
  windowMs: RATE_LIMIT_WEBHOOK_WINDOW_MS,
  max: RATE_LIMIT_WEBHOOK_MAX,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Trop de webhooks reçus",
    },
  },
});