// packages/shared/src/ssh-host-key.test.ts
import { describe, expect, it } from "vitest";
import {
  assertHostKeyTrusted,
  computeHostKeyFingerprint,
  hostKeyMatches,
  isValidHostKeyFingerprint,
  normalizeHostKeyFingerprint,
} from "./ssh-host-key";

describe("empreinte de clé d'hôte SSH", () => {
  const key = Buffer.from("host-key-material");
  const otherKey = Buffer.from("other-host-key-material");
  const fingerprint = computeHostKeyFingerprint(key);

  it("produit une empreinte OpenSSH stable", () => {
    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fingerprint).toBe(computeHostKeyFingerprint(key));
    expect(fingerprint).not.toBe(computeHostKeyFingerprint(otherKey));
    expect(fingerprint.endsWith("=")).toBe(false);
  });

  it("normalise le padding et les espaces", () => {
    expect(normalizeHostKeyFingerprint(` ${fingerprint}= `)).toBe(fingerprint);
    expect(isValidHostKeyFingerprint(fingerprint)).toBe(true);
    expect(isValidHostKeyFingerprint("MD5:aa:bb")).toBe(false);
    expect(isValidHostKeyFingerprint("")).toBe(false);
  });

  it("refuse une clé inconnue", () => {
    expect(() =>
      assertHostKeyTrusted(computeHostKeyFingerprint(otherKey), fingerprint, "srv"),
    ).toThrow(/inconnue ou modifiée/i);
  });

  it("refuse une clé modifiée", () => {
    expect(hostKeyMatches(fingerprint, computeHostKeyFingerprint(otherKey))).toBe(
      false,
    );
  });

  it("refuse une connexion sans référence de confiance", () => {
    expect(() => assertHostKeyTrusted(fingerprint, null, "srv")).toThrow(
      /non configurée/i,
    );
    expect(() => assertHostKeyTrusted(fingerprint, "SHA256:invalide", "srv")).toThrow(
      /non configurée/i,
    );
  });

  it("accepte la référence exacte", () => {
    expect(() => assertHostKeyTrusted(fingerprint, fingerprint, "srv")).not.toThrow();
    expect(hostKeyMatches(fingerprint, fingerprint)).toBe(true);
  });
});
