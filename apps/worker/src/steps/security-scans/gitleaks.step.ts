// apps/worker/src/steps/security-scans/gitleaks.step.ts
import { ScanOutcome, ScanType } from "@prisma/client";
import { GitleaksScanner } from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  persistScanFailure,
  persistScanResult,
} from "../../orchestrator/scanner.helper";

const scanner = new GitleaksScanner();

export async function gitleaksStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Vérification de la disponibilité de Gitleaks...");

  if (!(await scanner.isAvailable())) {
    await ctx.log("warn", "Gitleaks non installé — étape ignorée (échec technique signalé au Security Gate)");
    await persistScanFailure(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.SECRET,
      },
      {
        scanner: "gitleaks",
        outcome: ScanOutcome.SCANNER_UNAVAILABLE,
        reason: "gitleaks not found",
      },
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        skipped: true,
        technical: true,
        outcome: "SCANNER_UNAVAILABLE",
        reason: "gitleaks not found",
      },
    };
  }

  await ctx.log("info", "Exécution de Gitleaks (recherche de secrets)...");

  const result = await scanner.scan({
    workspaceDir: ctx.workspaceDir,
    onLog: ctx.log,
  });

  // Remonte les logs dans PipelineLog.
  for (const line of result.logs) {
    const level = line.startsWith("[error]")
      ? "error"
      : line.startsWith("[warn]")
        ? "warn"
        : line.startsWith("[debug]")
          ? "debug"
          : "info";
    await ctx.log(level, line);
  }

  // Persiste en base quoi qu'il arrive.
  await persistScanResult(
    {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      stepId: ctx.stepId,
      type: ScanType.SECRET,
    },
    result,
  );

  if (result.status === "FAILED") {
    return {
      success: false,
      exitCode: result.exitCode ?? 1,
      error: result.error ?? "Gitleaks a échoué",
      data: {
        outcome: result.outcome ?? "INTERRUPTED",
        reason: result.error ?? "Gitleaks a échoué",
      },
    };
  }

  // Le scan a réussi. La décision de bloquer appartient au Security Gate.
  // Cette étape retourne toujours success=true si le scan s'est bien déroulé,
  // même s'il a détecté des secrets.
  await ctx.log(
    "info",
    `Gitleaks : ${result.vulnerabilityCount} finding(s) — ` +
      `critical=${result.severityCounts.critical}, high=${result.severityCounts.high}`,
  );

  return {
    success: true,
    exitCode: 0,
    data: {
      scanner: "gitleaks",
      outcome:
        result.vulnerabilityCount > 0
          ? "SUCCESS_WITH_FINDINGS"
          : "SUCCESS_NO_FINDINGS",
      vulnerabilityCount: result.vulnerabilityCount,
      severityCounts: result.severityCounts,
    },
  };
}