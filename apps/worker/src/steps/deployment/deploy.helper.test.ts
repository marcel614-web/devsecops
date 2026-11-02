// apps/worker/src/steps/deployment/deploy.helper.test.ts
import { describe, it, expect } from "vitest";
import {
  assertImageDigestVerified,
  canRollbackToPrevious,
  isHealthyHttpCode,
  isStagingReadyForPromotion,
} from "./deploy.helper";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

/**
 * Un healthcheck qui accepte les 5xx déclarait « déploiement réussi »
 * alors que l'application derrière nginx était morte (502/503).
 */
describe("isHealthyHttpCode", () => {
  it.each(["200", "201", "204", "301", "302", "304"])(
    "accepte le code %s",
    (code) => {
      expect(isHealthyHttpCode(code)).toBe(true);
    },
  );

  it.each(["500", "502", "503", "504", "599"])(
    "refuse le code serveur %s (application morte)",
    (code) => {
      expect(isHealthyHttpCode(code)).toBe(false);
    },
  );

  it.each(["400", "401", "403", "404", "429"])(
    "refuse le code client %s",
    (code) => {
      expect(isHealthyHttpCode(code)).toBe(false);
    },
  );

  it.each(["", "FAILED", "000", "20", "2000", "abc", "2xx"])(
    "refuse la valeur non numérique %s",
    (code) => {
      expect(isHealthyHttpCode(code)).toBe(false);
    },
  );

  it("tolère les espaces autour du code", () => {
    expect(isHealthyHttpCode(" 200 ")).toBe(true);
    expect(isHealthyHttpCode(" 502 ")).toBe(false);
  });
});

describe("vérification du digest de l'artefact", () => {
  it("accepte exactement le digest validé", () => {
    expect(
      assertImageDigestVerified({
        resolved: EXPECTED,
        expected: EXPECTED,
        imageTag: "app:abc",
        exitCode: 0,
      }),
    ).toBe(EXPECTED);
  });

  it("refuse un autre digest sans reconstruire ni promouvoir", () => {
    expect(() =>
      assertImageDigestVerified({
        resolved: OTHER,
        expected: EXPECTED,
        imageTag: "app:abc",
        exitCode: 0,
      }),
    ).toThrow(/différent de l'artefact validé/);
  });

  it("refuse un digest illisible ou une image absente", () => {
    expect(() =>
      assertImageDigestVerified({
        resolved: "",
        expected: EXPECTED,
        imageTag: "app:abc",
        exitCode: 1,
      }),
    ).toThrow(/introuvable ou digest illisible/);

    expect(() =>
      assertImageDigestVerified({
        resolved: "sha256:zzz",
        expected: EXPECTED,
        imageTag: "app:abc",
        exitCode: 0,
      }),
    ).toThrow(/introuvable ou digest illisible/);
  });

  it("refuse un artefact non vérifié lorsqu'aucun digest n'est attendu", () => {
    expect(() =>
      assertImageDigestVerified({
        resolved: "pas-un-digest",
        expected: null,
        imageTag: "app:abc",
        exitCode: 0,
      }),
    ).toThrow();
  });
});

describe("décision de promotion et de rollback", () => {
  it("refuse la promotion si le staging n'a pas réussi", () => {
    expect(isStagingReadyForPromotion("FAILED")).toBe(false);
    expect(isStagingReadyForPromotion("RUNNING")).toBe(false);
    expect(isStagingReadyForPromotion(null)).toBe(false);
    expect(isStagingReadyForPromotion("SUCCESS")).toBe(true);
  });

  it("propose un rollback vers la version précédente identifiable", () => {
    expect(
      canRollbackToPrevious({
        autoRollback: true,
        previousImageTag: "app:old",
        previousImageDigest: OTHER,
        currentImageDigest: EXPECTED,
      }),
    ).toBe(true);
  });

  it("n'écrase pas la production par un rollback désactivé ou impossible", () => {
    expect(
      canRollbackToPrevious({
        autoRollback: false,
        previousImageTag: "app:old",
        previousImageDigest: OTHER,
        currentImageDigest: EXPECTED,
      }),
    ).toBe(false);
    expect(
      canRollbackToPrevious({
        autoRollback: true,
        previousImageTag: null,
        previousImageDigest: null,
        currentImageDigest: EXPECTED,
      }),
    ).toBe(false);
    expect(
      canRollbackToPrevious({
        autoRollback: true,
        previousImageTag: "app:same",
        previousImageDigest: EXPECTED,
        currentImageDigest: EXPECTED,
      }),
    ).toBe(false);
  });
});
