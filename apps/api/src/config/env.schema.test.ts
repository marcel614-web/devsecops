// apps/api/src/config/env.schema.test.ts
import { describe, it, expect } from "vitest";
import {
  EnvSchema,
  parseEnv,
  isPlaceholderSecret,
  MIN_SECRET_LENGTH,
} from "./env.schema";

/**
 * Jeu de base valide : sert de référence pour ne tester qu'un champ à la fois.
 */
const VALID: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "a-valid-access-secret-0123456789-abcdefgh",
  JWT_REFRESH_SECRET: "a-valid-refresh-secret-0123456789-abcdefg",
  MASTER_ENCRYPTION_KEY: "a-valid-master-key-0123456789-abcdefghij",
};

describe("isPlaceholderSecret", () => {
  it.each([
    "changeme-at-least-32-characters-long",
    "CHANGE-ME-32-CHARACTERS-AT-LEAST!!!!!",
    "change_me_32_characters_at_least_xxxxx",
    "placeholder-32-characters-at-least-xxxxx",
    "example-secret-32-characters-at-least-xx",
    "your-secret-here-32-characters-at-least-xx",
    "dummy-secret-32-characters-at-least-xxxxxx",
    "dev-master-key-32-bytes-change-me",
  ])("détecte le placeholder %s", (value) => {
    expect(isPlaceholderSecret(value)).toBe(true);
  });

  it.each([
    "9f8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0",
    "un-secret-reellement-aleatoire-et-long-012345",
  ])("accepte une vraie valeur aléatoire : %s", (value) => {
    expect(isPlaceholderSecret(value)).toBe(false);
  });
});

describe("parseEnv — secrets", () => {
  it("accepte une configuration complète et valide", () => {
    const env = parseEnv(VALID);
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
    expect(env.JWT_ACCESS_SECRET).toBe(VALID.JWT_ACCESS_SECRET);
  });

  it("refuse un JWT_ACCESS_SECRET trop court", () => {
    const result = EnvSchema.safeParse({
      ...VALID,
      JWT_ACCESS_SECRET: "trop-court",
    });
    expect(result.success).toBe(false);
  });

  it("refuse un JWT_ACCESS_SECRET de longueur valide mais placeholder", () => {
    // C'est exactement le défaut de `.env.example` : 35 caractères, donc
    // accepté par `min(32)` seul — mais la clé de signature est publique.
    const result = EnvSchema.safeParse({
      ...VALID,
      JWT_ACCESS_SECRET: "changeme-at-least-32-characters-long",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/démonstration/i);
    }
  });

  it("refuse un JWT_REFRESH_SECRET placeholder", () => {
    const result = EnvSchema.safeParse({
      ...VALID,
      JWT_REFRESH_SECRET: "changeme-at-least-32-characters-long",
    });
    expect(result.success).toBe(false);
  });

  it("refuse une MASTER_ENCRYPTION_KEY trop courte", () => {
    const result = EnvSchema.safeParse({ ...VALID, MASTER_ENCRYPTION_KEY: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        String(MIN_SECRET_LENGTH),
      );
    }
  });

  it("refuse la clé maîtresse de développement connue", () => {
    // base64("dev-master-key-32-bytes-change-me") — présente dans le .env
    // historique et dans le dump committé : elle déchiffre toutes les clés SSH.
    const result = EnvSchema.safeParse({
      ...VALID,
      MASTER_ENCRYPTION_KEY:
        "ZGV2LW1hc3Rlci1rZXktMzItYnl0ZXMtY2hhbmdlLW1l",
    });
    expect(result.success).toBe(false);
  });

  it("exige DATABASE_URL", () => {
    const env = { ...VALID };
    delete env.DATABASE_URL;
    const result = EnvSchema.safeParse(env);
    expect(result.success).toBe(false);
  });
});

describe("parseEnv — erreurs", () => {
  it("lève une Error listant tous les problèmes", () => {
    expect(() =>
      parseEnv({ ...VALID, JWT_ACCESS_SECRET: "short" }),
    ).toThrowError(/Configuration invalide/);
  });

  it("ne lève pas sur une configuration valide", () => {
    expect(() => parseEnv(VALID)).not.toThrow();
  });
});
