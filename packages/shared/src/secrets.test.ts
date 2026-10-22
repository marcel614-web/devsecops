// packages/shared/src/secrets.test.ts
import { describe, it, expect } from "vitest";
import {
  MIN_SECRET_LENGTH,
  isPlaceholderSecret,
  secretField,
} from "./secrets";

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

  it("détecte un placeholder encodé en base64", () => {
    // base64("dev-master-key-32-bytes-change-me")
    expect(
      isPlaceholderSecret("ZGV2LW1hc3Rlci1rZXktMzItYnl0ZXMtY2hhbmdlLW1l"),
    ).toBe(true);
  });

  it.each([
    "9f8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0",
    "un-secret-reellement-aleatoire-et-long-012345",
  ])("accepte une vraie valeur aléatoire : %s", (value) => {
    expect(isPlaceholderSecret(value)).toBe(false);
  });

  it("ne confond pas une valeur base64 aléatoire avec un placeholder", () => {
    const randomB64 = Buffer.from("9f8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c").toString(
      "base64",
    );
    expect(isPlaceholderSecret(randomB64)).toBe(false);
  });
});

describe("secretField", () => {
  const schema = secretField("TEST_SECRET");

  it("exige une longueur minimale", () => {
    const result = schema.safeParse("trop-court");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        String(MIN_SECRET_LENGTH),
      );
    }
  });

  it("refuse un placeholder de longueur suffisante", () => {
    const result = schema.safeParse("changeme-at-least-32-characters-long");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/démonstration/i);
    }
  });

  it("accepte une valeur aléatoire suffisamment longue", () => {
    const result = schema.safeParse("a".repeat(MIN_SECRET_LENGTH));
    expect(result.success).toBe(true);
  });
});
