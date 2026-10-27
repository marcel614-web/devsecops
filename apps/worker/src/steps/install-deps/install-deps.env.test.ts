// apps/worker/src/steps/install-deps/install-deps.env.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { buildSandboxExecEnv } from "../../isolation/sandbox-config";

/**
 * `pip install .` et `composer install` exécutent du code du dépôt dans la
 * sandbox. L'environnement transmis au conteneur ne doit contenir aucun
 * secret de plateforme, même si le processus worker les possède.
 */
describe("buildSandboxExecEnv — isolation des gestionnaires de dépendances", () => {
  const secrets = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/devsecops",
    MASTER_ENCRYPTION_KEY: "master-key-that-must-never-leak",
    JWT_ACCESS_SECRET: "jwt-access-secret",
    JWT_REFRESH_SECRET: "jwt-refresh-secret",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
    GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_TOKEN: "ghs_token",
    DOCKER_HOST: "tcp://127.0.0.1:2375",
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
    const env = buildSandboxExecEnv();
    for (const key of Object.keys(secrets)) {
      expect(env[key]).toBeUndefined();
    }
  });

  it("ne transmet pas le PATH de l'hôte (le conteneur a le sien)", () => {
    const env = buildSandboxExecEnv();
    expect(env.PATH).toBeUndefined();
    expect(env.HOME).toBe("/tmp");
    expect(env.PIP_CACHE_DIR).toBe("/tmp/pip-cache");
    expect(env.PIP_DISABLE_PIP_VERSION_CHECK).toBe("1");
    expect(env.PIP_NO_INPUT).toBe("1");
    expect(env.PIP_RETRIES).toBe("5");
    expect(env.PIP_DEFAULT_TIMEOUT).toBe("60");
  });

  it("transmet un index pip configurable sans identifiants", () => {
    const old = process.env.PIP_INDEX_URL;
    process.env.PIP_INDEX_URL = "https://mirror.example/simple";
    try {
      const env = buildSandboxExecEnv();
      expect(env.PIP_INDEX_URL).toBe("https://mirror.example/simple");
      expect(env.DATABASE_URL).toBeUndefined();
    } finally {
      if (old === undefined) delete process.env.PIP_INDEX_URL;
      else process.env.PIP_INDEX_URL = old;
    }
  });

  it("refuse un index pip contenant un jeton", () => {
    const old = process.env.PIP_INDEX_URL;
    process.env.PIP_INDEX_URL = "https://user:secret@mirror.example/simple";
    try {
      const env = buildSandboxExecEnv();
      expect(env.PIP_INDEX_URL).toBeUndefined();
    } finally {
      if (old === undefined) delete process.env.PIP_INDEX_URL;
      else process.env.PIP_INDEX_URL = old;
    }
  });

  it("permet d'ajouter explicitement une variable non secrète", () => {
    const env = buildSandboxExecEnv({}, { COMPOSER_CACHE_DIR: "/tmp/composer" });
    expect(env.COMPOSER_CACHE_DIR).toBe("/tmp/composer");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("refuse d'injecter un secret via les variables explicites", () => {
    expect(() =>
      buildSandboxExecEnv({}, { DATABASE_URL: "postgres://leak" }),
    ).toThrow(/interdite/i);
  });
});
