// apps/api/src/middleware/rateLimiter.ts
import rateLimit, { type Options } from "express-rate-limit";
import {
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_GLOBAL_WINDOW_MS,
  RATE_LIMIT_WEBHOOK_MAX,
  RATE_LIMIT_WEBHOOK_WINDOW_MS,
} from "../config/constants";
import { isDev, isTest } from "../config/env";

/**
 * En test, les limiteurs sont désactivés par défaut pour éviter les
 * tests flaky. Les tests qui vérifient explicitement le comportement du
 * rate limit activent le limiteur via `setRateLimitsEnabledInTest(true)`.
 */
let enabledInTest = false;

export function setRateLimitsEnabledInTest(enabled: boolean): void {
  enabledInTest = enabled;
}

export function areRateLimitsEnabled(): boolean {
  // En développement, on désactive les rate limits pour éviter les blocages
  // lors des tests de connexion (ex: "Trop de tentatives d'authentification").
  if (isDev) return false;
  return !isTest || enabledInTest;
}

/**
 * Fabrique commune : tous les limiteurs partagent la même forme de
 * réponse d'erreur pour que le front puisse les traiter uniformément.
 *
 * Le type de retour est `Partial<Options>` et non `Options` : depuis
 * express-rate-limit v7.5, le type `Options` déclare tous les champs comme
 * obligatoires, alors que la librairie complète les champs absents par
 * ses propres valeurs par défaut au moment de l'exécution
 * (`...notUndefinedOptions`). `rateLimit()` attend justement un
 * `Partial<Options>`.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
}): Partial<Options> {
  return {
    standardHeaders: true as const,
    legacyHeaders: false as const,
    windowMs: options.windowMs,
    // `max` est déprécié depuis la v7 : le champ canonique est `limit`.
    limit: options.max,
    skip: () => !areRateLimitsEnabled(),
    message: {
      error: {
        code: "TOO_MANY_REQUESTS",
        message: options.message,
      },
    },
  };
}

export const globalLimiter = rateLimit(
  createRateLimiter({
    windowMs: RATE_LIMIT_GLOBAL_WINDOW_MS,
    max: RATE_LIMIT_GLOBAL_MAX,
    message: "Trop de requêtes, veuillez réessayer plus tard",
  }),
);

export const authLimiter = rateLimit(
  createRateLimiter({
    windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
    max: RATE_LIMIT_AUTH_MAX,
    message: "Trop de tentatives d'authentification, réessayez plus tard",
  }),
);

export const webhookLimiter = rateLimit(
  createRateLimiter({
    windowMs: RATE_LIMIT_WEBHOOK_WINDOW_MS,
    max: RATE_LIMIT_WEBHOOK_MAX,
    message: "Trop de webhooks reçus",
  }),
);
