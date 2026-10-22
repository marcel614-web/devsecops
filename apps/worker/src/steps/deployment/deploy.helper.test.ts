// apps/worker/src/steps/deployment/deploy.helper.test.ts
import { describe, it, expect } from "vitest";
import { isHealthyHttpCode } from "./deploy.helper";

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
