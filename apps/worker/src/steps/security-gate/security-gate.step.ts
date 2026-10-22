// apps/worker/src/steps/security-gate/security-gate.step.ts
import {
  SecurityGateMode,
  SecurityGateStatus,
  StepStatus,
  VulnerabilityStatus,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

// ============================================================
// TYPES
// ============================================================

interface GateRules {
  critical: number; // nombre max autorisé (0 = interdit)
  high: number;
  medium: number;
  low: number; // -1 = illimité
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

interface TechnicalFailure {
  category: string;
  step: string;
  reason: string;
}

interface AppliedException {
  id: string;
  category: string;
  severity: string | null;
  fingerprint: string | null;
  reason: string;
  expiresAt: string | null;
}

interface GateVulnerability {
  id: string;
  severity: string;
  fingerprint: string | null;
  reference: string | null;
  status: VulnerabilityStatus;
  scan: { type: string; scanner: string };
}

interface GateException {
  id: string;
  category: string;
  severity: string | null;
  fingerprint: string | null;
  reason: string;
  expiresAt: Date | null;
}

interface GateEvaluation {
  status: SecurityGateStatus;
  blocked: boolean;
  reason: string | null;
  counts: SeverityCounts;
  rawCounts: SeverityCounts;
  rules: GateRules;
  mode: SecurityGateMode;
  technicalFailures: TechnicalFailure[];
  exceptionsApplied: AppliedException[];
}

const CATEGORIES = ["SECRET", "SAST", "SCA", "IMAGE", "IAC", "DAST"] as const;
type GateCategory = (typeof CATEGORIES)[number];

const STEP_TYPE_BY_CATEGORY: Record<GateCategory, string> = {
  SECRET: "SECRET_SCAN",
  SAST: "SAST",
  SCA: "SCA",
  IMAGE: "IMAGE_SCAN",
  IAC: "IAC_SCAN",
  DAST: "DAST",
};

const SEVERITY_KEYS = ["critical", "high", "medium", "low", "info"] as const;

// ============================================================
// ÉVALUATION
// ============================================================

function evaluateThresholds(
  counts: SeverityCounts,
  rules: GateRules,
): string[] {
  const violations: string[] = [];

  if (counts.critical > rules.critical) {
    violations.push(`CRITICAL: ${counts.critical} > seuil ${rules.critical}`);
  }
  if (counts.high > rules.high) {
    violations.push(`HIGH: ${counts.high} > seuil ${rules.high}`);
  }
  if (counts.medium > rules.medium) {
    violations.push(`MEDIUM: ${counts.medium} > seuil ${rules.medium}`);
  }
  if (rules.low >= 0 && counts.low > rules.low) {
    violations.push(`LOW: ${counts.low} > seuil ${rules.low}`);
  }

  return violations;
}

function effectiveMode(
  config: { gateMode: SecurityGateMode; gateEnforcementAt: Date | null },
  now: Date,
): SecurityGateMode {
  if (!config.gateEnforcementAt) return config.gateMode;
  // Une date future impose le mode avertissement jusqu'à échéance.
  if (config.gateEnforcementAt.getTime() > now.getTime()) {
    return SecurityGateMode.WARNING;
  }
  return SecurityGateMode.ENFORCEMENT;
}

function categoryEnabled(
  config: {
    gateSecretsEnabled: boolean;
    gateSastEnabled: boolean;
    gateScaEnabled: boolean;
    gateImageEnabled: boolean;
    gateIacEnabled: boolean;
    gateDastEnabled: boolean;
  },
  category: GateCategory,
): boolean {
  switch (category) {
    case "SECRET":
      return config.gateSecretsEnabled;
    case "SAST":
      return config.gateSastEnabled;
    case "SCA":
      return config.gateScaEnabled;
    case "IMAGE":
      return config.gateImageEnabled;
    case "IAC":
      return config.gateIacEnabled;
    case "DAST":
      return config.gateDastEnabled;
  }
}

/** Compteurs de sévérité vides. */
export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/**
 * Vrai si une exception cible CE finding.
 *
 * Une exception sans `fingerprint` est volontairement ignorée : c'était le
 * bug historique. Une exception « SCA + CRITICAL » supprimait sinon tous
 * les findings CRITICAL de la catégorie, y compris des CVE non concernées.
 */
export function exceptionMatchesFinding(
  exception: Pick<
    GateException,
    "category" | "severity" | "fingerprint"
  >,
  finding: Pick<GateVulnerability, "severity" | "fingerprint" | "reference">,
  category: GateCategory,
): boolean {
  if (!exception.fingerprint || exception.fingerprint.trim() === "") {
    return false;
  }
  if (exception.category !== "ALL" && exception.category !== category) {
    return false;
  }
  if (exception.severity && exception.severity !== finding.severity) {
    return false;
  }

  const target = exception.fingerprint.trim().toLowerCase();
  return [finding.fingerprint, finding.reference].some(
    (value) => value?.trim().toLowerCase() === target,
  );
}

// ============================================================
// ÉTAPE
// ============================================================

export async function securityGateStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Security Gate : lecture de la configuration du projet...");

  // 1. Configuration.
  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId: ctx.projectId },
  });
  if (!config) {
    await ctx.log("error", "Configuration du projet introuvable — gate en échec");
    return {
      success: false,
      exitCode: 1,
      error: "Configuration du projet introuvable",
    };
  }

  const now = new Date();
  const mode = effectiveMode(config, now);
  const rules: GateRules = {
    critical: config.securityGateCritical,
    high: config.securityGateHigh,
    medium: config.securityGateMedium,
    low: config.securityGateLow,
  };

  await ctx.log(
    "info",
    `Mode : ${mode}` +
      (config.gateEnforcementAt
        ? ` (bascule prévue le ${config.gateEnforcementAt.toISOString()})`
        : ""),
  );
  await ctx.log(
    "info",
    `Seuils : critical=${rules.critical}, high=${rules.high}, ` +
      `medium=${rules.medium}, low=${rules.low < 0 ? "illimité" : rules.low}`,
  );

  // 2. Scans, étapes, exceptions et findings du pipeline.
  //    Les findings individuels sont nécessaires pour appliquer une
  //    exception à un CVE précis, sans masquer tout le bucket de sévérité.
  const [scans, steps, exceptions, vulnerabilities] = await Promise.all([
    prisma.securityScan.findMany({
      where: { pipelineId: ctx.pipelineId },
      select: {
        scanner: true,
        type: true,
        criticalCount: true,
        highCount: true,
        mediumCount: true,
        lowCount: true,
        infoCount: true,
        status: true,
      },
    }),
    prisma.pipelineStep.findMany({
      where: { pipelineId: ctx.pipelineId },
      select: { name: true, type: true, status: true, resultJson: true },
    }),
    prisma.securityGateException.findMany({
      where: {
        projectId: ctx.projectId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.vulnerability.findMany({
      where: { scan: { pipelineId: ctx.pipelineId } },
      select: {
        id: true,
        severity: true,
        fingerprint: true,
        reference: true,
        status: true,
        scan: { select: { type: true, scanner: true } },
      },
    }),
  ]);

  // 3. Échecs techniques : un scanner en échec ou indisponible ne doit
  //    jamais être interprété comme « 0 vulnérabilité ».
  const technicalFailures: TechnicalFailure[] = [];

  for (const category of CATEGORIES) {
    if (!categoryEnabled(config, category)) continue;

    const expectedStepType = STEP_TYPE_BY_CATEGORY[category];
    const step = steps.find((s) => s.type === expectedStepType);

    if (!step) {
      technicalFailures.push({
        category,
        step: expectedStepType,
        reason: "Étape non exécutée",
      });
      continue;
    }

    if (
      step.status === StepStatus.FAILED ||
      step.status === StepStatus.CANCELLED
    ) {
      technicalFailures.push({
        category,
        step: step.name,
        reason:
          step.status === StepStatus.CANCELLED
            ? "Étape annulée ou non exécutée"
            : "Le scanner a échoué",
      });
      continue;
    }

    const data = (step.resultJson ?? {}) as {
      skipped?: boolean;
      technical?: boolean;
      reason?: string;
    };
    if (data.skipped === true && data.technical === true) {
      technicalFailures.push({
        category,
        step: step.name,
        reason: data.reason ?? "Scanner indisponible",
      });
    }
  }

  // Supply chain : SBOM (Syft) et signature (Cosign).
  const supplyChainSteps: Array<{
    enabled: boolean;
    type: string;
    category: string;
  }> = [
    { enabled: config.syftEnabled, type: "SBOM", category: "SBOM" },
    { enabled: config.cosignEnabled, type: "SIGN", category: "SIGN" },
  ];

  for (const item of supplyChainSteps) {
    if (!item.enabled) continue;
    const step = steps.find((s) => s.type === item.type);
    if (!step) {
      technicalFailures.push({
        category: item.category,
        step: item.type,
        reason: "Étape non exécutée",
      });
    } else if (
      step.status === StepStatus.FAILED ||
      step.status === StepStatus.CANCELLED
    ) {
      technicalFailures.push({
        category: item.category,
        step: step.name,
        reason:
          step.status === StepStatus.CANCELLED
            ? "Étape annulée ou non exécutée"
            : "L'étape a échoué",
      });
    } else {
      const data = (step.resultJson ?? {}) as {
        skipped?: boolean;
        technical?: boolean;
        reason?: string;
      };
      if (data.skipped === true && data.technical === true) {
        technicalFailures.push({
          category: item.category,
          step: step.name,
          reason: data.reason ?? "Outil indisponible",
        });
      }
    }
  }

  // Échecs persistés dans SecurityScan (Trivy, ZAP, etc.).
  for (const scan of scans) {
    if (scan.status === StepStatus.FAILED) {
      const already = technicalFailures.some(
        (f) => f.category === scan.type && f.reason === "Le scanner a échoué",
      );
      if (!already) {
        technicalFailures.push({
          category: scan.type,
          step: scan.scanner,
          reason: "Le scanner a échoué",
        });
      }
    }
  }

  // 4. Compteurs + application des exceptions finding par finding.
  //
  // On ne retire plus un bucket entier dès qu'une exception
  // « catégorie + sévérité » existe. On compte uniquement les findings
  // dont le fingerprint/reference correspond à l'exception.
  const rawCounts = emptySeverityCounts();
  const counts = emptySeverityCounts();
  const exceptionsApplied: AppliedException[] = [];
  const acceptedStatuses = new Set<VulnerabilityStatus>([
    VulnerabilityStatus.FALSE_POSITIVE,
    VulnerabilityStatus.RISK_ACCEPTED,
    VulnerabilityStatus.DUPLICATE,
  ]);

  const broadExceptions = exceptions.filter(
    (e) => !e.fingerprint || e.fingerprint.trim() === "",
  );
  if (broadExceptions.length > 0) {
    await ctx.log(
      "warn",
      `${broadExceptions.length} exception(s) sans fingerprint ignorée(s) : ` +
        "une exception doit cibler un CVE, une règle ou une empreinte précise.",
    );
  }

  // Clé = type de scan + scanner, pour ne pas déduire deux fois le même
  // finding quand plusieurs scanners alimentent la même catégorie.
  const scanKey = (type: string, scanner: string): string =>
    `${type}|${scanner}`;
  const excludedByScan = new Map<string, SeverityCounts>();

  for (const vuln of vulnerabilities as GateVulnerability[]) {
    const category = vuln.scan.type as GateCategory;
    if (!CATEGORIES.includes(category)) continue;
    if (!categoryEnabled(config, category)) continue;

    const key = vuln.severity.toLowerCase() as keyof SeverityCounts;
    if (!(key in rawCounts)) continue;

    const accepted = acceptedStatuses.has(vuln.status);
    const exception = exceptions.find((e) =>
      exceptionMatchesFinding(e, vuln, category),
    );

    // Ni faux positif/risque accepté, ni exception ciblée : le finding
    // reste compté.
    if (!accepted && !exception) continue;

    const bucket = excludedByScan.get(scanKey(vuln.scan.type, vuln.scan.scanner)) ??
      emptySeverityCounts();
    bucket[key] += 1;
    excludedByScan.set(
      scanKey(vuln.scan.type, vuln.scan.scanner),
      bucket,
    );

    if (exception && !exceptionsApplied.some((a) => a.id === exception.id)) {
      exceptionsApplied.push({
        id: exception.id,
        category: exception.category,
        severity: exception.severity,
        fingerprint: exception.fingerprint,
        reason: exception.reason,
        expiresAt: exception.expiresAt?.toISOString() ?? null,
      });
    }
  }

  for (const scan of scans) {
    const category = scan.type as GateCategory;
    if (!CATEGORIES.includes(category)) continue;
    if (!categoryEnabled(config, category)) continue;

    const values: SeverityCounts = {
      critical: scan.criticalCount,
      high: scan.highCount,
      medium: scan.mediumCount,
      low: scan.lowCount,
      info: scan.infoCount,
    };
    const excluded =
      excludedByScan.get(scanKey(scan.type, scan.scanner)) ??
      emptySeverityCounts();

    for (const key of SEVERITY_KEYS) {
      rawCounts[key] += values[key];
      counts[key] += Math.max(0, values[key] - excluded[key]);
    }
  }

  // 5. Logs par scanner.
  for (const s of scans) {
    await ctx.log(
      "info",
      `Scan ${s.scanner} (${s.type}) : C=${s.criticalCount} H=${s.highCount} ` +
        `M=${s.mediumCount} L=${s.lowCount} I=${s.infoCount} [${s.status}]`,
    );
  }
  await ctx.log(
    "info",
    `Totaux retenus : critical=${counts.critical}, high=${counts.high}, ` +
      `medium=${counts.medium}, low=${counts.low}` +
      (exceptionsApplied.length > 0
        ? ` — ${exceptionsApplied.length} exception(s) appliquée(s)`
        : ""),
  );

  // 6. Évaluation.
  const violations = evaluateThresholds(counts, rules);
  const hasIssues = violations.length > 0 || technicalFailures.length > 0;

  let status: SecurityGateStatus;
  let blocked = false;
  const reasons: string[] = [];

  if (!hasIssues) {
    status = SecurityGateStatus.PASSED;
  } else {
    for (const v of violations) reasons.push(v);
    for (const f of technicalFailures) {
      reasons.push(`Échec technique ${f.category} (${f.step}) : ${f.reason}`);
    }

    if (mode === SecurityGateMode.ENFORCEMENT) {
      status = SecurityGateStatus.BLOCKED;
      blocked = true;
    } else {
      status = SecurityGateStatus.WARNING;
      blocked = false;
    }
  }

  const reason = reasons.length > 0 ? reasons.join(" | ") : null;

  const evaluation: GateEvaluation = {
    status,
    blocked,
    reason,
    counts,
    rawCounts,
    rules,
    mode,
    technicalFailures,
    exceptionsApplied,
  };

  // 7. Persistance.
  await prisma.securityGateResult.upsert({
    where: { pipelineId: ctx.pipelineId },
    create: {
      pipelineId: ctx.pipelineId,
      status: evaluation.status,
      mode: evaluation.mode,
      rulesJson: {
        ...rules,
        mode: evaluation.mode,
        categories: {
          SECRET: config.gateSecretsEnabled,
          SAST: config.gateSastEnabled,
          SCA: config.gateScaEnabled,
          IMAGE: config.gateImageEnabled,
          IAC: config.gateIacEnabled,
          DAST: config.gateDastEnabled,
        },
        rawCounts: evaluation.rawCounts,
      } as unknown as object,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      blocked: evaluation.blocked,
      reason,
      technicalFailures: technicalFailures as unknown as object,
      exceptionsApplied: exceptionsApplied as unknown as object,
    },
    update: {
      status: evaluation.status,
      mode: evaluation.mode,
      rulesJson: {
        ...rules,
        mode: evaluation.mode,
        categories: {
          SECRET: config.gateSecretsEnabled,
          SAST: config.gateSastEnabled,
          SCA: config.gateScaEnabled,
          IMAGE: config.gateImageEnabled,
          IAC: config.gateIacEnabled,
          DAST: config.gateDastEnabled,
        },
        rawCounts: evaluation.rawCounts,
      } as unknown as object,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      blocked: evaluation.blocked,
      reason,
      technicalFailures: technicalFailures as unknown as object,
      exceptionsApplied: exceptionsApplied as unknown as object,
    },
  });

  // 8. Décision.
  if (blocked) {
    await ctx.log(
      "error",
      `Security Gate : DÉPLOIEMENT BLOQUÉ (${mode}) — ${reason}`,
    );
    return {
      success: false,
      exitCode: 1,
      blockDeployment: true,
      error: reason ?? "Seuils de sécurité dépassés",
      data: {
        gate: "BLOCKED",
        mode,
        counts,
        rawCounts,
        rules,
        technicalFailures,
        exceptionsApplied,
        reason,
      },
    };
  }

  if (status === SecurityGateStatus.WARNING) {
    await ctx.log(
      "warn",
      `Security Gate : AVERTISSEMENT (${mode}) — ${reason}. ` +
        "Le déploiement est autorisé (mode avertissement).",
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        gate: "WARNING",
        mode,
        counts,
        rawCounts,
        rules,
        technicalFailures,
        exceptionsApplied,
        reason,
      },
    };
  }

  await ctx.log("info", "Security Gate : PASSED — aucun seuil dépassé");
  return {
    success: true,
    exitCode: 0,
    data: {
      gate: "PASSED",
      mode,
      counts,
      rawCounts,
      rules,
      technicalFailures: [],
      exceptionsApplied,
    },
  };
}
