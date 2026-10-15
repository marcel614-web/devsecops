// apps/api/src/config/constants.ts

/**
 * Constantes applicatives non sensibles.
 * Aucune valeur secrète ici.
 */

// --- Cookies ---
export const ACCESS_COOKIE_NAME = "ds_access";
export const REFRESH_COOKIE_NAME = "ds_refresh";

// --- JWT ---
export const JWT_ISSUER = "devsecops-platform";
export const JWT_AUDIENCE = "devsecops-api";

// --- Rate limiting ---
export const RATE_LIMIT_GLOBAL_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const RATE_LIMIT_GLOBAL_MAX = 5000;

export const RATE_LIMIT_AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const RATE_LIMIT_AUTH_MAX = 10;

export const RATE_LIMIT_WEBHOOK_WINDOW_MS = 60 * 1000; // 1 min
export const RATE_LIMIT_WEBHOOK_MAX = 60;

// --- Rôles ---
export const ROLES = {
  ADMIN: "ADMIN",
  DEVELOPER: "DEVELOPER",
} as const;

export type RoleName = keyof typeof ROLES;

// --- Pagination ---
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// --- Longueurs ---
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 100;

// --- Divers ---
export const ARGON2_ALGORITHM = "argon2id";
export const BCRYPT_ROUNDS_PLACEHOLDER = null; // on n'utilise pas bcrypt, mais documenté

// --- En-têtes ---
export const HEADER_REQUEST_ID = "x-request-id";
export const HEADER_GITHUB_SIGNATURE = "x-hub-signature-256";
export const HEADER_GITHUB_EVENT = "x-github-event";
export const HEADER_GITHUB_DELIVERY = "x-github-delivery";