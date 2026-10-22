// apps/worker/src/test/setup.ts
/**
 * Environnement de test du worker.
 *
 * Exécuté avant tout import applicatif. `config/env.ts` du worker valide
 * DATABASE_URL, MASTER_ENCRYPTION_KEY et Redis : on les positionne ici pour
 * que la suite ne dépende pas du `.env` de la machine de développement.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.MASTER_ENCRYPTION_KEY = "test-master-key-0123456789-abcdefghijkl";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://devsecops:devsecops@localhost:5432/devsecops_test?schema=public";
process.env.REDIS_HOST = process.env.TEST_REDIS_HOST ?? "localhost";
process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? "6379";
process.env.REDIS_PASSWORD = process.env.TEST_REDIS_PASSWORD ?? "";
