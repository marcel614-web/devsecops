// packages/shared/src/git.test.ts
import { describe, it, expect } from "vitest";
import {
  isValidGitSha,
  isFullGitSha,
  assertValidGitSha,
  GIT_SHA_PATTERN,
  FULL_GIT_SHA_PATTERN,
  MANUAL_SHA_PATTERN,
} from "./git";

describe("isValidGitSha", () => {
  it("accepte un SHA Git complet (40 caractères)", () => {
    expect(
      isValidGitSha("e83c5163316f89bfbde7d9ab23ca2e25604af290"),
    ).toBe(true);
  });

  it("accepte un SHA court (7 caractères)", () => {
    expect(isValidGitSha("e83c516")).toBe(true);
  });

  it("accepte un SHA majuscule", () => {
    expect(isValidGitSha("E83C5163316F89FBBDE7D9AB23CA2E25604AF290")).toBe(true);
  });

  it("accepte le SHA de substitution interne", () => {
    expect(isValidGitSha("manual-1717171717171")).toBe(true);
  });

  it.each([
    // Injection classique : guillemet + commande
    '"; id; "',
    'abc"; rm -rf / #',
    // Substitution de commande
    "$(whoami)",
    "`id`",
    // Injection par espace / séparateur
    "abc def",
    // Suffixe de ligne
    "abcdefg\nid",
    // Trop court
    "abc",
    // Non hexadécimal
    "z".repeat(40),
    // Trop long (41 caractères)
    "a".repeat(41),
  ])("refuse la valeur hostile %s", (value) => {
    expect(isValidGitSha(value)).toBe(false);
  });
});

describe("isFullGitSha", () => {
  it("accepte uniquement un SHA complet de 40 ou 64 caractères", () => {
    expect(isFullGitSha("e83c5163316f89bfbde7d9ab23ca2e25604af290")).toBe(
      true,
    );
    expect(isFullGitSha("a".repeat(64))).toBe(true);
    expect(isFullGitSha("e83c516")).toBe(false);
    expect(isFullGitSha("manual-1717171717171")).toBe(false);
    expect(isFullGitSha("a".repeat(39))).toBe(false);
    expect(isFullGitSha("a".repeat(41))).toBe(false);
  });
});

describe("assertValidGitSha", () => {
  it("met en minuscules un SHA hexadécimal", () => {
    expect(assertValidGitSha("E83C516")).toBe("e83c516");
  });

  it("lève une erreur sur une valeur invalide", () => {
    expect(() => assertValidGitSha('"; id; "')).toThrowError(/invalide/i);
  });

  it("préserve le préfixe manual-", () => {
    expect(assertValidGitSha("manual-1717171717171")).toBe(
      "manual-1717171717171",
    );
  });
});

describe("patterns", () => {
  it("GIT_SHA_PATTERN n'accepte que de l'hexadécimal", () => {
    expect(GIT_SHA_PATTERN.test("deadbeef")).toBe(true);
    expect(GIT_SHA_PATTERN.test("deadbeeg")).toBe(false);
  });

  it("MANUAL_SHA_PATTERN n'accepte que des timestamps", () => {
    expect(MANUAL_SHA_PATTERN.test("manual-1717171717171")).toBe(true);
    expect(MANUAL_SHA_PATTERN.test("manual-abc")).toBe(false);
  });
});
