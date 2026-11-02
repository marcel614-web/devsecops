// apps/worker/src/steps/security-gate/security-gate.step.ts
import {
  SecurityGateMode,
  SecurityGateStatus,
  type PipelineStep,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { loadPipelineSecurityPolicy } from "../../security/policy";
import {
  evaluateSecurityGate,
  type GateException,
  type GateScan,
  type GateStep,
  type GateVulnerability,
  type SeverityCounts,
} from "./security-gate.policy";
import type { GateCategory } from "@devsecops/shared";

const CATEGORIES = ["SECRET", "SAST", "SCA", "IMAGE", "IAC", "DAST"] as const;

function gateKeyFor(step: PipelineStep): string {
  return step.name.toLowerCase().includes("post-dast")
    ? "POST_DAST"
    : "PRE_DEPLOY";
}

function toCounts(scan: {
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
}): SeverityCounts {
  return {
    critical: scan.criticalCount,
    high: scan.highCount,
    medium: scan.mediumCount,
    low: scan.lowCount,
    info: scan.infoCount,
  };
}

export async function securityGateStep(
  step: PipelineStep,
  ctx: StepContext,
): Promise<StepResult> {
  const gateKey = gateKeyFor(step);
  await ctx.log(
    "info",
    `Security Gate ${gateKey} : chargement de la politique figée du pipeline...`,
  );

  // 1. Politique immuable. La configuration courante n'est JAMAIS relue
  //    pour un pipeline qui possède déjà son instantané.
  let loaded;
  try {
    loaded = await loadPipelineSecurityPolicy(ctx.pipelineId, ctx.projectId, ctx.log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Politique de sécurité indisponible — ${message}`);
    return {
      success: false,
      exitCode: 1,
      error: `Politique de sécurité indisponible : ${message}`,
    };
  }
  const { policy, policyHash } = loaded;

  await ctx.log(
    "info",
    `Politique v${policy.version} (${policyHash.slice(0, 12)}) — mode ${policy.mode}` +
      (policy.enforcementAt
        ? `, bascule prévue le ${policy.enforcementAt}`
        : ""),
  );
  await ctx.log(
    "info",
    `Seuils : critical=${policy.thresholds.critical}, high=${policy.thresholds.high}, ` +
      `medium=${policy.thresholds.medium}, low=${
        policy.thresholds.low < 0 ? "illimité" : policy.thresholds.low
      }`,
  );

  // 2. Résultats normalisés, étapes et exceptions.
  const [scanRows, stepRows, exceptionRows, vulnerabilityRows] =
    await Promise.all([
      prisma.securityScan.findMany({
        where: { pipelineId: ctx.pipelineId },
        select: {
          scanner: true,
          type: true,
          status: true,
          outcome: true,
          criticalCount: true,
          highCount: true,
          mediumCount: true,
          lowCount: true,
          infoCount: true,
        },
      }),
      prisma.pipelineStep.findMany({
        where: { pipelineId: ctx.pipelineId },
        select: {
          name: true,
          type: true,
          status: true,
          resultJson: true,
        },
      }),
      prisma.securityGateException.findMany({
        where: { projectId: ctx.projectId },
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

  const scans: GateScan[] = scanRows
    .filter((scan) => CATEGORIES.includes(scan.type as GateCategory))
    .map((scan) => ({
      category: scan.type as GateCategory,
      scanner: scan.scanner,
      status: scan.status,
      outcome: scan.outcome,
      counts: toCounts(scan),
    }));

  const steps: GateStep[] = stepRows;
  const exceptions: GateException[] = exceptionRows.map((exception) => ({
    id: exception.id,
    category: exception.category,
    severity: exception.severity,
    fingerprint: exception.fingerprint,
    matchType: exception.matchType,
    status: exception.status,
    reason: exception.reason,
    expiresAt: exception.expiresAt,
  }));
  const vulnerabilities: GateVulnerability[] = vulnerabilityRows
    .filter((vulnerability) =>
      CATEGORIES.includes(vulnerability.scan.type as GateCategory),
    )
    .map((vulnerability) => ({
      id: vulnerability.id,
      severity: vulnerability.severity,
      fingerprint: vulnerability.fingerprint,
      reference: vulnerability.reference,
      status: vulnerability.status,
      category: vulnerability.scan.type as GateCategory,
      scanner: vulnerability.scan.scanner,
    }));

  // 3. Évaluation indépendante de la syntaxe des scanners.
  const evaluation = evaluateSecurityGate({
    policy,
    scans,
    steps,
    vulnerabilities,
    exceptions,
  });

  for (const control of evaluation.controls) {
    const level =
      control.state === "SUCCESS_NO_FINDINGS" ||
      control.state === "SUCCESS_WITH_FINDINGS"
        ? "info"
        : control.state === "DISABLED" || control.state === "NOT_APPLICABLE"
          ? "info"
          : "warn";
    await ctx.log(
      level,
      `Contrôle ${control.category} : ${control.state}` +
        (control.reason ? ` — ${control.reason}` : ""),
    );
  }
  for (const ignored of evaluation.exceptionsIgnored) {
    await ctx.log(
      "warn",
      `Exception ${ignored.id} ignorée pour cette décision : ${ignored.reason}`,
    );
  }
  for (const exception of evaluation.exceptionsApplied) {
    await ctx.log(
      "info",
      `Exception appliquée ${exception.id} (${exception.matchType}) sur ` +
        `${exception.findingReference ?? exception.findingFingerprint ?? "finding"}`,
    );
  }
  for (const scan of scans) {
    await ctx.log(
      "info",
      `Scan ${scan.scanner} (${scan.category}) : C=${scan.counts.critical} ` +
        `H=${scan.counts.high} M=${scan.counts.medium} L=${scan.counts.low} ` +
        `I=${scan.counts.info} [${scan.status}/${scan.outcome ?? "n/a"}]`,
    );
  }
  await ctx.log(
    "info",
    `Totaux retenus : critical=${evaluation.counts.critical}, ` +
      `high=${evaluation.counts.high}, medium=${evaluation.counts.medium}, ` +
      `low=${evaluation.counts.low}` +
      (evaluation.exceptionsApplied.length > 0
        ? ` — ${evaluation.exceptionsApplied.length} exception(s) appliquée(s)`
        : ""),
  );

  const persistedStatus: SecurityGateStatus =
    evaluation.status === "PASSED"
      ? SecurityGateStatus.PASSED
      : evaluation.status === "WARNING"
        ? SecurityGateStatus.WARNING
        : SecurityGateStatus.BLOCKED;

  const controlsJson = evaluation.controls as unknown as object;
  // SecurityGateResult.exceptionsApplied attend la liste des exceptions
  // réellement appliquées. Les exceptions ignorées restent dans rulesJson
  // et dans l'historique PipelineGateEvaluation.
  const exceptionsJson = evaluation.exceptionsApplied as unknown as object;
  const technicalFailuresJson = evaluation.technicalFailures as unknown as object;
  const countsJson = {
    retained: evaluation.counts,
    raw: evaluation.rawCounts,
  } as unknown as object;
  const rulesJson = {
    policyVersion: policy.version,
    policyHash,
    gateKey,
    mode: evaluation.mode,
    thresholds: policy.thresholds,
    categories: policy.categories,
    controls: evaluation.controls,
    rawCounts: evaluation.rawCounts,
    exceptionsIgnored: evaluation.exceptionsIgnored,
  } as unknown as object;

  // 4. Historique par gate + résumé pour l'interface.
  await prisma.pipelineGateEvaluation.upsert({
    where: {
      pipelineId_gateKey: { pipelineId: ctx.pipelineId, gateKey },
    },
    create: {
      pipelineId: ctx.pipelineId,
      policySnapshotId: loaded.snapshotId,
      gateKey,
      status: persistedStatus,
      mode: evaluation.mode as SecurityGateMode,
      blocked: evaluation.blocked,
      thresholdsJson: policy.thresholds as unknown as object,
      controlsJson,
      exceptionsJson,
      technicalFailures: technicalFailuresJson,
      countsJson,
      reason: evaluation.reason,
    },
    update: {
      policySnapshotId: loaded.snapshotId,
      status: persistedStatus,
      mode: evaluation.mode as SecurityGateMode,
      blocked: evaluation.blocked,
      thresholdsJson: policy.thresholds as unknown as object,
      controlsJson,
      exceptionsJson,
      technicalFailures: technicalFailuresJson,
      countsJson,
      reason: evaluation.reason,
      evaluatedAt: new Date(),
    },
  });

  await prisma.securityGateResult.upsert({
    where: { pipelineId: ctx.pipelineId },
    create: {
      pipelineId: ctx.pipelineId,
      status: persistedStatus,
      mode: evaluation.mode as SecurityGateMode,
      rulesJson,
      critical: evaluation.counts.critical,
      high: evaluation.counts.high,
      medium: evaluation.counts.medium,
      low: evaluation.counts.low,
      blocked: evaluation.blocked,
      reason: evaluation.reason,
      technicalFailures: technicalFailuresJson,
      exceptionsApplied: exceptionsJson,
    },
    update: {
      status: persistedStatus,
      mode: evaluation.mode as SecurityGateMode,
      rulesJson,
      critical: evaluation.counts.critical,
      high: evaluation.counts.high,
      medium: evaluation.counts.medium,
      low: evaluation.counts.low,
      blocked: evaluation.blocked,
      reason: evaluation.reason,
      technicalFailures: technicalFailuresJson,
      exceptionsApplied: exceptionsJson,
    },
  });

  const data = {
    gate: evaluation.status,
    gateKey,
    policyVersion: policy.version,
    policyHash,
    mode: evaluation.mode,
    counts: evaluation.counts,
    rawCounts: evaluation.rawCounts,
    thresholds: policy.thresholds,
    controls: evaluation.controls,
    technicalFailures: evaluation.technicalFailures,
    exceptionsApplied: evaluation.exceptionsApplied,
    exceptionsIgnored: evaluation.exceptionsIgnored,
    reason: evaluation.reason,
  };

  // 5. Décision.
  if (evaluation.blocked) {
    await ctx.log(
      "error",
      `Security Gate ${gateKey} : BLOQUÉ (${evaluation.mode}) — ${evaluation.reason}`,
    );
    return {
      success: false,
      exitCode: 1,
      blockDeployment: true,
      error: evaluation.reason ?? "Seuils de sécurité dépassés",
      data,
    };
  }

  if (evaluation.status === "WARNING") {
    await ctx.log(
      "warn",
      `Security Gate ${gateKey} : AVERTISSEMENT (${evaluation.mode}) — ` +
        `${evaluation.reason}. Le pipeline continue mais sera marqué ` +
        "SUCCESS_WITH_WARNINGS.",
    );
    return { success: true, exitCode: 0, data };
  }

  await ctx.log(
    "info",
    `Security Gate ${gateKey} : PASSED — aucun seuil dépassé et tous les ` +
      "contrôles requis ont produit un résultat exploitable",
  );
  return { success: true, exitCode: 0, data };
}
