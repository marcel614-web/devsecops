// apps/api/src/modules/github/branch-protection.test.ts
import { describe, expect, it } from "vitest";
import { buildReport, matchesRefPattern } from "./branch-protection.service";

const FULL_PERMISSIONS = {
  administration: "read",
  checks: "write",
  contents: "read",
  metadata: "read",
};

function report(overrides: {
  protection?: Partial<{
    enabled: boolean | null;
    requiredStatusChecks: string[];
    strictUpToDate: boolean | null;
    enforceAdmins: boolean | null;
  }>;
  rulesets?: Partial<{
    verifiable: boolean;
    items: Array<{ id: number; name: string; enforcement: string }>;
    requiredStatusChecks: string[];
  }>;
  permissions?: Record<string, string>;
  protectionError?: unknown;
  rulesetsError?: unknown;
} = {}) {
  return buildReport({
    repository: "acme/demo",
    branch: "main",
    protection: {
      enabled: true,
      requiredStatusChecks: [],
      strictUpToDate: true,
      enforceAdmins: true,
      ...overrides.protection,
    },
    rulesets: {
      verifiable: true,
      items: [],
      requiredStatusChecks: [],
      ...overrides.rulesets,
    },
    appPermissions: overrides.permissions ?? FULL_PERMISSIONS,
    protectionError: overrides.protectionError ?? null,
    rulesetsError: overrides.rulesetsError ?? null,
  });
}

describe("vérification des protections de branche", () => {
  it("détecte le Check Run DevSecOps obligatoire", () => {
    const result = report({
      protection: {
        requiredStatusChecks: ["DevSecOps Manager / Security Gate"],
      },
    });

    expect(result.verifiable).toBe(true);
    expect(result.devSecOpsCheckRequired).toBe(true);
    expect(result.correctiveSteps.join(" ")).toContain("ne bloque la fusion");
  });

  it("distingue un check absent d'un check non vérifiable", () => {
    const absent = report();
    expect(absent.verifiable).toBe(true);
    expect(absent.devSecOpsCheckRequired).toBe(false);

    const unverifiable = report({
      permissions: { administration: "read" },
      protectionError: { status: 403 },
    });
    expect(unverifiable.verifiable).toBe(false);
    expect(unverifiable.devSecOpsCheckRequired).toBeNull();
    expect(unverifiable.reason).toMatch(/permissions/i);
    expect(unverifiable.missingPermissions).toContain("Checks: write");
  });

  it("signale une absence de protection et propose les étapes correctives", () => {
    const result = report({
      protection: { enabled: false },
      protectionError: { status: 404 },
    });

    expect(result.verifiable).toBe(true);
    expect(result.protectionEnabled).toBe(false);
    expect(result.rulesetsEnabled).toBe(false);
    expect(result.devSecOpsCheckRequired).toBe(false);
    expect(result.correctiveSteps.join(" ")).toContain(
      "Créer une protection de branche",
    );
    expect(result.correctiveSteps.join(" ")).toContain(
      "Security Gate",
    );
  });

  it("ne prétend pas que la protection est absente si l'API refuse l'accès", () => {
    const result = report({
      protection: { enabled: null },
      protectionError: { status: 403 },
      rulesetsError: { status: 403 },
    });

    expect(result.verifiable).toBe(false);
    expect(result.protectionEnabled).toBeNull();
    expect(result.rulesetsEnabled).toBeNull();
    expect(result.devSecOpsCheckRequired).toBeNull();
    expect(result.reason).not.toMatch(/absente/i);
  });

  it("lit un check obligatoire défini dans un ruleset", () => {
    const result = report({
      rulesets: {
        items: [{ id: 1, name: "main-protection", enforcement: "active" }],
        requiredStatusChecks: ["DevSecOps Manager / Security Gate"],
      },
    });

    expect(result.devSecOpsCheckRequired).toBe(true);
    expect(result.rulesetsEnabled).toBe(true);
  });

  it("fait correspondre les motifs de refs des rulesets", () => {
    expect(matchesRefPattern("main", "refs/heads/main")).toBe(true);
    expect(matchesRefPattern("main", "refs/heads/*")).toBe(true);
    expect(matchesRefPattern("release/1.0", "refs/heads/release/*")).toBe(true);
    expect(matchesRefPattern("feature/x", "refs/heads/main")).toBe(false);
    expect(matchesRefPattern("feature/x", "refs/heads/release/*")).toBe(false);
  });
});
