// apps/worker/src/steps/install-deps/install-deps.env.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { buildDependencyEnv } from "./install-deps.step";

/**
 * `pip install .` et `composer install` exécutent du code du dépôt.
 * L'environnement transmis ne doit contenir aucun secret de plateforme.
 */
describe("buildDependencyEnv — isolation des gestionnaires de dépendances", () => {
  const secrets = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/devsecops",
    MASTER_ENCRYPTION_KEY: "master-key-that-must-never-leak",
    JWT_ACCESS_SECRET: "jwt-access-secret",
    JWT_REFRESH_SECRET: "jwt-refresh-secret",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
    GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
  };

  const previous: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(secrets)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("ne transmet aucun secret de plateforme", () => {
    const env = buildDependencyEnv();
    for (const key of Object.keys(secrets)) {
      expect(env[key]).toBeUndefined();
    }
  });

  it("transmet les variables nécessaires à pip", () => {
    const env = buildDependencyEnv();
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.PIP_CACHE_DIR).toBeTruthy();
    expect(env.PIP_DISABLE_PIP_VERSION_CHECK).toBe("1");
    expect(env.PIP_NO_INPUT).toBe("1");
  });

  it("permet d'ajouter explicitement une variable non secrète", () => {
    const env = buildDependencyEnv({ COMPOSER_CACHE_DIR: "/tmp/composer" });
    expect(env.COMPOSER_CACHE_DIR).toBe("/tmp/composer");
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
