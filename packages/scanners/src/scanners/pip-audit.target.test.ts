// packages/scanners/src/scanners/pip-audit.target.test.ts
import { describe, expect, it } from "vitest";
import { pickPipAuditTarget } from "./pip-audit.scanner";

describe("pickPipAuditTarget — pas d'exécution du projet sur l'hôte", () => {
  it("préfère le freeze rapatrié de la sandbox", () => {
    expect(
      pickPipAuditTarget({
        hasFrozen: true,
        hasRequirements: true,
        hasVenv: true,
      }),
    ).toEqual(["-r", ".devsecops/pip-freeze.txt"]);
  });

  it("utilise requirements.txt à défaut", () => {
    expect(
      pickPipAuditTarget({
        hasFrozen: false,
        hasRequirements: true,
        hasVenv: false,
      }),
    ).toEqual(["-r", "requirements.txt"]);
  });

  it("utilise un venv local existant", () => {
    expect(
      pickPipAuditTarget({
        hasFrozen: false,
        hasRequirements: false,
        hasVenv: true,
      }),
    ).toEqual(["--path", ".venv"]);
  });

  it("ne retombe jamais sur le projet lui-même (.)", () => {
    expect(
      pickPipAuditTarget({
        hasFrozen: false,
        hasRequirements: false,
        hasVenv: false,
      }),
    ).toBeNull();
  });
});
