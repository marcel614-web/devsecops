// apps/worker/src/steps/security-gate/security-gate.step.ts
import { SecurityGateStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

interface GateRules {
  critical: number; // nombre max autorisé (0 = interdit)
  high: number;
  medium: number;
  low: number; // -1 = illimité
}

interface GateEvaluation {
  status: SecurityGateStatus;
  blocked: boolean;
  reason: string | null;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  rules: GateRules;
}

/**
 * Évalue les résultats de sécurité selon les seuils du projet.
 * Ne dépend d'aucun retour client — la décision est entièrement calculée ici.
 */
function evaluate(
  counts: GateEvaluation["counts"],
  rules: GateRules,
): GateEvaluation {
  let blocked = false;
  const reasons: string[] = [];

  if (counts.critical > rules.critical) {
    blocked = true;
    reasons.push(
      `CRITICAL: ${counts.critical} > seuil ${rules.critical}`,
    );
  }
  if (counts.high > rules.high) {
    blocked = true;
    reasons.push(`HIGH: ${counts.high} > seuil ${rules.high}`);
  }
  if (counts.medium > rules.medium) {
    blocked = true;
    reasons.push(`MEDIUM: ${counts.medium} > seuil ${rules.medium}`);
  }
  if (rules.low >= 0 && counts.low > rules.low) {
    blocked = true;
    reasons.push(`LOW: ${counts.low} > seuil ${rules.low}`);
  }

  return {
    status: blocked ? SecurityGateStatus.BLOCKED : SecurityGateStatus.PASSED,
    blocked,
    reason: blocked ? reasons.join(" | ") : null,
    counts,
    rules,
  };
}

export async function securityGateStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Security Gate : lecture des seuils du projet...");

  // 1. Charge la config du projet.
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

  const rules: GateRules = {
    critical: config.securityGateCritical,
    high: config.securityGateHigh,
    medium: config.securityGateMedium,
    low: config.securityGateLow,
  };

  await ctx.log(
    "info",
    `Seuils : critical=${rules.critical}, high=${rules.high}, ` +
      `medium=${rules.medium}, low=${rules.low < 0 ? "illimité" : rules.low}`,
  );

  // 2. Agrège tous les scans du pipeline.
  const scans = await prisma.securityScan.findMany({
    where: { pipelineId: ctx.pipelineId },
    select: {
      scanner: true,
      criticalCount: true,
      highCount: true,
      mediumCount: true,
      lowCount: true,
      infoCount: true,
      status: true,
    },
  });

  if (scans.length === 0) {
    await ctx.log("warn", "Aucun scan trouvé — gate évalué sur compteurs vides");
  }

  const counts = scans.reduce(
    (acc, s) => ({
      critical: acc.critical + s.criticalCount,
      high: acc.high + s.highCount,
      medium: acc.medium + s.mediumCount,
      low: acc.low + s.lowCount,
      info: acc.info + s.infoCount,
    }),
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  );

  // Logs par scanner pour traçabilité.
  for (const s of scans) {
    await ctx.log(
      "info",
      `Scan ${s.scanner} : C=${s.criticalCount} H=${s.highCount} ` +
        `M=${s.mediumCount} L=${s.lowCount} I=${s.infoCount}`,
    );
  }

  await ctx.log(
    "info",
    `Totaux : critical=${counts.critical}, high=${counts.high}, ` +
      `medium=${counts.medium}, low=${counts.low}`,
  );

  // 3. Évalue.
  const evaluation = evaluate(counts, rules);

  // 4. Persiste le résultat du gate (upsert car pipelineId est unique).
  await prisma.securityGateResult.upsert({
    where: { pipelineId: ctx.pipelineId },
    create: {
      pipelineId: ctx.pipelineId,
      status: evaluation.status,
      rulesJson: rules as unknown as object,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      blocked: evaluation.blocked,
      reason: evaluation.reason,
    },
    update: {
      status: evaluation.status,
      rulesJson: rules as unknown as object,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      blocked: evaluation.blocked,
      reason: evaluation.reason,
    },
  });

  // 5. Décision.
  if (evaluation.blocked) {
    await ctx.log(
      "error",
      `Security Gate : DÉPLOIEMENT BLOQUÉ — ${evaluation.reason}`,
    );
    return {
      success: false,
      exitCode: 1,
      blockDeployment: true,
      error: evaluation.reason ?? "Seuils de sécurité dépassés",
      data: {
        gate: "BLOCKED",
        counts,
        rules,
        reason: evaluation.reason,
      },
    };
  }

  await ctx.log(
    "info",
    `Security Gate : PASSED — aucun seuil dépassé`,
  );
  return {
    success: true,
    exitCode: 0,
    data: {
      gate: "PASSED",
      counts,
      rules,
    },
  };
}