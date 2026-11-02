// apps/worker/src/steps/security-gate/security-gate.policy.test.ts
import { describe, expect, it } from "vitest";
import {
  buildSecurityPolicy,
  hashSecurityPolicy,
  type SecurityPolicyV1,
} from "@devsecops/shared";
import {
  emptySeverityCounts,
  evaluateSecurityGate,
  exceptionMatchesFinding,
  type GateException,
  type GateScan,
  type GateStep,
  type GateVulnerability,
  type SeverityCounts,
} from "./security-gate.policy";

const NOW = new Date("2026-10-28T12:00:00.000Z");

function policy(
  overrides: Partial<Parameters<typeof buildSecurityPolicy>[0]> = {},
): SecurityPolicyV1 {
  return buildSecurityPolicy({
    securityGateCritical: 0,
    securityGateHigh: 0,
    securityGateMedium: 10,
    securityGateLow: -1,
    gateMode: "WARNING",
    gateEnforcementAt: null,
    gateSecretsEnabled: true,
    gateSastEnabled: false,
    gateScaEnabled: true,
    gateImageEnabled: false,
    gateIacEnabled: false,
    gateDastEnabled: false,
    gitleaksEnabled: true,
    semgrepEnabled: false,
    scaEnabled: true,
    trivyEnabled: false,
    iacEnabled: false,
    zapEnabled: false,
    mandatoryControls: ["SECRET", "SCA"],
    requireExceptionApproval: true,
    policyVersion: 3,
    ...overrides,
  });
}

function counts(overrides: Partial<SeverityCounts> = {}): SeverityCounts {
  return { ...emptySeverityCounts(), ...overrides };
}

function scan(
  category: GateScan["category"],
  overrides: Partial<GateScan> = {},
): GateScan {
  return {
    category,
    scanner: category === "SECRET" ? "gitleaks" : "sca",
    status: "SUCCESS",
    outcome: "SUCCESS_NO_FINDINGS",
    counts: counts(),
    ...overrides,
  };
}

function steps(overrides: GateStep[] = []): GateStep[] {
  const base: GateStep[] = [
    { name: "Gitleaks", type: "SECRET_SCAN", status: "SUCCESS" },
    { name: "SCA", type: "SCA", status: "SUCCESS" },
  ];
  return [...base, ...overrides];
}

function baseScans(): GateScan[] {
  return [scan("SECRET"), scan("SCA")];
}

function vulnerability(
  overrides: Partial<GateVulnerability> = {},
): GateVulnerability {
  return {
    id: "vuln-1",
    severity: "CRITICAL",
    fingerprint: "fp-secret-1",
    reference: "gitleaks:aws-access-token",
    status: "OPEN",
    category: "SECRET",
    scanner: "gitleaks",
    ...overrides,
  };
}

function exception(overrides: Partial<GateException> = {}): GateException {
  return {
    id: "exc-1",
    category: "SECRET",
    severity: null,
    fingerprint: "fp-secret-1",
    matchType: "FINGERPRINT",
    status: "APPROVED",
    reason: "Faux positif confirmé par l'équipe sécurité",
    expiresAt: new Date("2026-11-28T12:00:00.000Z"),
    ...overrides,
  };
}

describe("politique de sécurité versionnée", () => {
  it("produit une empreinte stable et sensible à la version", () => {
    const a = policy();
    const b = policy();
    const c = policy({ policyVersion: 4 });

    expect(hashSecurityPolicy(a)).toBe(hashSecurityPolicy(b));
    expect(hashSecurityPolicy(a)).not.toBe(hashSecurityPolicy(c));
    expect(a.version).toBe(3);
  });

  it("normalise les catégories et les contrôles obligatoires par défaut", () => {
    const built = buildSecurityPolicy({
      ...policy(),
      mandatoryControls: ["secret", "inconnu"],
    } as never);

    expect(built.categories.SECRET.mandatory).toBe(true);
    expect(built.categories.SCA.mandatory).toBe(false);
  });
});

describe("Security Gate — seuils et modes", () => {
  it("signale un secret sans bloquer en mode WARNING", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "WARNING" }),
      scans: [
        ...baseScans().filter((s) => s.category !== "SECRET"),
        scan("SECRET", {
          outcome: "SUCCESS_WITH_FINDINGS",
          counts: counts({ critical: 1 }),
        }),
      ],
      steps: steps(),
      vulnerabilities: [vulnerability()],
      now: NOW,
    });

    expect(result.status).toBe("WARNING");
    expect(result.blocked).toBe(false);
    expect(result.reason).toContain("CRITICAL: 1 > seuil 0");
  });

  it("bloque la même vulnérabilité en mode ENFORCEMENT", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "ENFORCEMENT" }),
      scans: [
        ...baseScans().filter((s) => s.category !== "SECRET"),
        scan("SECRET", {
          outcome: "SUCCESS_WITH_FINDINGS",
          counts: counts({ critical: 1 }),
        }),
      ],
      steps: steps(),
      vulnerabilities: [vulnerability()],
      now: NOW,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blocked).toBe(true);
  });

  it("ne bloque pas une catégorie désactivée par la politique", () => {
    const result = evaluateSecurityGate({
      policy: policy({
        gateMode: "ENFORCEMENT",
        gateSastEnabled: false,
        semgrepEnabled: false,
      }),
      scans: [
        ...baseScans(),
        scan("SAST", {
          scanner: "semgrep",
          outcome: "SUCCESS_WITH_FINDINGS",
          counts: counts({ critical: 5 }),
        }),
      ],
      steps: [
        { name: "Gitleaks", type: "SECRET_SCAN", status: "SUCCESS" },
        { name: "SCA", type: "SCA", status: "SUCCESS" },
      ],
      vulnerabilities: [],
      now: NOW,
    });

    expect(result.status).toBe("PASSED");
    expect(result.controls.find((c) => c.category === "SAST")?.state).toBe(
      "DISABLED",
    );
  });
});

describe("Security Gate — exceptions", () => {
  const secretScan = scan("SECRET", {
    outcome: "SUCCESS_WITH_FINDINGS",
    counts: counts({ critical: 1 }),
  });
  const scansWithSecretFinding = [scan("SCA"), secretScan];

  it("applique une exception valide qui cible l'empreinte exacte", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "ENFORCEMENT" }),
      scans: scansWithSecretFinding,
      steps: steps(),
      vulnerabilities: [vulnerability()],
      exceptions: [exception()],
      now: NOW,
    });

    expect(result.status).toBe("PASSED");
    expect(result.counts.critical).toBe(0);
    expect(result.rawCounts.critical).toBe(1);
    expect(result.exceptionsApplied).toHaveLength(1);
  });

  it("n'applique pas une exception expirée", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "ENFORCEMENT" }),
      scans: scansWithSecretFinding,
      steps: steps(),
      vulnerabilities: [vulnerability()],
      exceptions: [
        exception({ expiresAt: new Date("2026-10-27T12:00:00.000Z") }),
      ],
      now: NOW,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.counts.critical).toBe(1);
    expect(result.exceptionsApplied).toHaveLength(0);
    expect(result.exceptionsIgnored[0]?.reason).toBe("Exception expirée");
  });

  it("n'applique pas une exception qui cible un autre finding", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "ENFORCEMENT" }),
      scans: scansWithSecretFinding,
      steps: steps(),
      vulnerabilities: [vulnerability()],
      exceptions: [exception({ fingerprint: "fp-autre-secret" })],
      now: NOW,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.counts.critical).toBe(1);
  });

  it("refuse une exception sans cible (ne masque pas une catégorie)", () => {
    const noTarget = exception({ fingerprint: null });
    expect(
      exceptionMatchesFinding(noTarget, vulnerability(), "SECRET", NOW),
    ).toBe(false);

    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "ENFORCEMENT" }),
      scans: scansWithSecretFinding,
      steps: steps(),
      vulnerabilities: [vulnerability()],
      exceptions: [noTarget],
      now: NOW,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.counts.critical).toBe(1);
  });

  it("ignore une exception non approuvée", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateMode: "ENFORCEMENT" }),
      scans: scansWithSecretFinding,
      steps: steps(),
      vulnerabilities: [vulnerability()],
      exceptions: [exception({ status: "PENDING" })],
      now: NOW,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.exceptionsApplied).toHaveLength(0);
  });
});

describe("Security Gate — états de contrôle", () => {
  it("ne présente jamais un scanner indisponible comme un succès", () => {
    const result = evaluateSecurityGate({
      policy: policy(),
      scans: [
        scan("SCA"),
        scan("SECRET", {
          status: "FAILED",
          outcome: "SCANNER_UNAVAILABLE",
          counts: counts(),
        }),
      ],
      steps: [
        {
          name: "Gitleaks",
          type: "SECRET_SCAN",
          status: "SUCCESS_WITH_WARNINGS",
          resultJson: {
            skipped: true,
            technical: true,
            outcome: "SCANNER_UNAVAILABLE",
            reason: "gitleaks not found",
          },
        },
        { name: "SCA", type: "SCA", status: "SUCCESS" },
      ],
      vulnerabilities: [],
      now: NOW,
    });

    const control = result.controls.find((c) => c.category === "SECRET");
    expect(control?.state).toBe("SCANNER_UNAVAILABLE");
    expect(control?.state).not.toBe("SUCCESS_NO_FINDINGS");
    // SECRET est obligatoire : le gate bloque même en WARNING.
    expect(result.status).toBe("BLOCKED");
    expect(result.technicalFailures[0]?.mandatory).toBe(true);
  });

  it("distingue une erreur de parsing d'un scan sans résultat", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateScaEnabled: true, scaEnabled: true }),
      scans: [
        scan("SECRET"),
        scan("SCA", {
          status: "FAILED",
          outcome: "PARSE_ERROR",
          counts: counts(),
        }),
      ],
      steps: [
        { name: "Gitleaks", type: "SECRET_SCAN", status: "SUCCESS" },
        { name: "SCA", type: "SCA", status: "FAILED" },
      ],
      vulnerabilities: [],
      now: NOW,
    });

    const control = result.controls.find((c) => c.category === "SCA");
    expect(control?.state).toBe("PARSE_ERROR");
    expect(result.status).toBe("BLOCKED");
  });

  it("signale une étape obligatoire ignorée", () => {
    const result = evaluateSecurityGate({
      policy: policy(),
      scans: [scan("SECRET")],
      steps: [
        { name: "Gitleaks", type: "SECRET_SCAN", status: "SUCCESS" },
        { name: "SCA", type: "SCA", status: "SKIPPED" },
      ],
      vulnerabilities: [],
      now: NOW,
    });

    const control = result.controls.find((c) => c.category === "SCA");
    expect(control?.state).toBe("REQUIRED_NOT_RUN");
    expect(result.status).toBe("BLOCKED");
    expect(result.reason).toContain("Contrôle obligatoire non exécuté");
  });

  it("traite un contrôle facultatif désactivé comme DISABLED, sans échec", () => {
    const result = evaluateSecurityGate({
      policy: policy({
        gateDastEnabled: true,
        zapEnabled: false,
        mandatoryControls: ["SECRET", "SCA"],
      }),
      scans: [
        scan("SECRET"),
        scan("SCA", {
          status: "SUCCESS",
          outcome: "SUCCESS_NO_FINDINGS",
        }),
      ],
      steps: steps(),
      vulnerabilities: [],
      now: NOW,
    });

    const control = result.controls.find((c) => c.category === "DAST");
    expect(control?.state).toBe("DISABLED");
    expect(result.technicalFailures).toHaveLength(0);
    expect(result.status).toBe("PASSED");
  });

  it("marque NOT_APPLICABLE lorsqu'un scanner déclare le contrôle non applicable", () => {
    const result = evaluateSecurityGate({
      policy: policy({ gateDastEnabled: true, zapEnabled: true }),
      scans: [
        ...baseScans(),
        scan("DAST", {
          scanner: "zap",
          outcome: "NOT_APPLICABLE",
        }),
      ],
      steps: [
        ...steps(),
        {
          name: "OWASP ZAP",
          type: "DAST",
          status: "SUCCESS",
          resultJson: {
            skipped: true,
            outcome: "NOT_APPLICABLE",
            reason: "Aucun serveur de staging",
          },
        },
      ],
      vulnerabilities: [],
      now: NOW,
    });

    const control = result.controls.find((c) => c.category === "DAST");
    expect(control?.state).toBe("NOT_APPLICABLE");
    expect(result.status).toBe("PASSED");
  });
});
