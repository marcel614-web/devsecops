// apps/worker/src/utils/sandbox-env.test.ts
import { describe, it, expect } from "vitest";
import {
  buildSandboxEnv,
  FORBIDDEN_IN_CHILD_ENV,
} from "./sandbox-env";

/**
 * Ces tests sont la barrière qui empêche le code d'un dépôt non fiable
 * d'exfiltrer les secrets de la plateforme.
 */

const PARENT_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/home/worker",
  TEMP: "/tmp",
  SystemRoot: "C:\\Windows",
  // Secrets de la plateforme
  DATABASE_URL: "postgresql://devsecops:devsecops@localhost:5432/devsecops",
  MASTER_ENCRYPTION_KEY: "super-secret-master-key-value-32chars",
  JWT_ACCESS_SECRET: "super-secret-access-token-signing-key",
  JWT_REFRESH_SECRET: "super-secret-refresh-token-signing-key",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n",
  GITHUB_APP_WEBHOOK_SECRET: "webhook-secret-value",
  GITHUB_CLIENT_SECRET: "client-secret-value",
  REDIS_PASSWORD: "redis-password-value",
  COSIGN_PASSWORD: "cosign-password-value",
  COSIGN_REGISTRY_PASSWORD: "registry-password-value",
  // Variables anodines mais utiles
  NPM_CONFIG_CACHE: "/cache/npm",
  TRIVY_CACHE_DIR: "/cache/trivy",
  ZAP_IMAGE: "ghcr.io/zaproxy/zaproxy:stable",
};

describe("buildSandboxEnv — confinement des secrets", () => {
  const child = buildSandboxEnv(PARENT_ENV);

  it.each(FORBIDDEN_IN_CHILD_ENV)(
    "ne transmet jamais %s au processus enfant",
    (name) => {
      expect(child[name]).toBeUndefined();
    },
  );

  it("ne contient aucune variable dont le nom évoque un secret", () => {
    const suspicious = Object.keys(child).filter((key) =>
      /SECRET|PASSWORD|TOKEN|PRIVATE_KEY|DATABASE_URL|MASTER/i.test(key),
    );
    expect(suspicious).toEqual([]);
  });

  it("transmet les variables nécessaires aux outils", () => {
    expect(child.PATH).toBe("/usr/bin");
    expect(child.HOME).toBe("/home/worker");
    expect(child.TEMP).toBe("/tmp");
    expect(child.TRIVY_CACHE_DIR).toBe("/cache/trivy");
    expect(child.ZAP_IMAGE).toBe("ghcr.io/zaproxy/zaproxy:stable");
  });

  it("retrouve une variable Windows malgré la casse (SystemRoot)", () => {
    // Sur Windows, `SystemRoot` et `SYSTEMROOT` désignent la même
    // variable : la lecture doit être insensible à la casse.
    const keys = Object.keys(child).map((k) => k.toLowerCase());
    expect(keys).toContain("systemroot");
    const value = Object.entries(child).find(
      ([k]) => k.toLowerCase() === "systemroot",
    )?.[1];
    expect(value).toBe("C:\\Windows");
  });

  it("n'expose que les clés de l'allow-list", () => {
    // Aucune clé inattendue ne doit apparaître.
    const unexpected = Object.keys(child).filter(
      (key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
    );
    expect(unexpected).toEqual([]);
  });
});

describe("buildSandboxEnv — variables supplémentaires", () => {
  it("ajoute les variables explicitement autorisées", () => {
    const child = buildSandboxEnv(PARENT_ENV, {
      NPM_CONFIG_CACHE: "/tmp/npm-cache",
      CUSTOM_FLAG: "1",
    });
    expect(child.NPM_CONFIG_CACHE).toBe("/tmp/npm-cache");
    expect(child.CUSTOM_FLAG).toBe("1");
  });

  it("permet de surcharger une variable de l'allow-list", () => {
    const child = buildSandboxEnv(PARENT_ENV, { PATH: "/custom/bin" });
    expect(child.PATH).toBe("/custom/bin");
  });

  it("ignore les variables supplémentaires indéfinies", () => {
    const child = buildSandboxEnv(PARENT_ENV, { UNDEFINED_VAR: undefined });
    expect(child.UNDEFINED_VAR).toBeUndefined();
  });
});

describe("buildSandboxEnv — comportement par défaut", () => {
  it("ne transmet aucun secret depuis le process.env réel", () => {
    // Contrôle de non-régression : même si le process réel contient des
    // secrets, ils ne doivent pas fuiter.
    process.env.MASTER_ENCRYPTION_KEY = "real-master-key-0123456789abcdefghij";
    process.env.DATABASE_URL = "postgresql://user:pass@host/db";

    try {
      const child = buildSandboxEnv();
      expect(child.MASTER_ENCRYPTION_KEY).toBeUndefined();
      expect(child.DATABASE_URL).toBeUndefined();
    } finally {
      delete process.env.MASTER_ENCRYPTION_KEY;
      delete process.env.DATABASE_URL;
    }
  });

  it("force GIT_TERMINAL_PROMPT à 0 (pas d'interaction interactive)", () => {
    const child = buildSandboxEnv({ PATH: "/usr/bin" });
    expect(child.GIT_TERMINAL_PROMPT).toBe("0");
  });
});
