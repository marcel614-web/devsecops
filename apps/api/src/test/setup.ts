// apps/api/src/test/setup.ts
/**
 * Environnement de test.
 *
 * Ce fichier est exécuté AVANT tout import applicatif (vitest `setupFiles`).
 * Il positionne les variables d'environnement de test pour que :
 *  - `config/env.ts` valide (Zod) sans lire le `.env` de production ;
 *  - le validateur de secrets rejette les placeholders ;
 *  - la base utilisée soit la base de TEST, jamais celle de dev.
 *
 * `dotenv.config({ override: false })` ne surcharge pas les variables déjà
 * présentes dans `process.env` : les valeurs ci-dessous restent prioritaires.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

// Secrets de test — volontairement des valeurs distinctes et non-placeholders.
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789-abcdefghij";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789-abcdefg";
process.env.MASTER_ENCRYPTION_KEY = "test-master-key-0123456789-abcdefghijkl";

// Base de test dédiée. Si aucune n'est fournie, on retombe sur le nom
// explicite `devsecops_test` pour ne jamais toucher `devsecops` par erreur.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://devsecops:devsecops@localhost:5432/devsecops_test?schema=public";

process.env.REDIS_HOST = process.env.TEST_REDIS_HOST ?? "localhost";
process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? "6379";
process.env.REDIS_PASSWORD = process.env.TEST_REDIS_PASSWORD ?? "";

// Le port n'est pas écouté en test (supertest), mais la valeur doit rester
// valide pour le schéma Zod.
process.env.API_PORT = "4001";
process.env.API_URL = "http://localhost:4001";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.BACKEND_URL = "http://localhost:4001";
