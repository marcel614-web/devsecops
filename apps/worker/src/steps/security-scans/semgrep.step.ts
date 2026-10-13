// apps/worker/src/steps/security-scans/semgrep.step.ts
import { ScanType } from "@prisma/client";
import { SemgrepScanner } from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { persistScanResult } from "../../orchestrator/scanner.helper";

const scanner = new SemgrepScanner();

export async function semgrepStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Vérification de la disponibilité de Semgrep...");

  if (!(await scanner.isAvailable())) {
    await ctx.log("warn", "Semgrep non installé — étape ignorée");
    return { success: true, exitCode: 0, data: { skipped: true, reason: "semgrep not found" } };
  }

  await ctx.log("info", "Exécution de Semgrep (analyse statique)...");

  const result = await scanner.scan({
    workspaceDir: ctx.workspaceDir,
    onLog: ctx.log,
  });

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

  await persistScanResult(
    {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      stepId: ctx.stepId,
      type: ScanType.SAST,
    },
    result,
  );

  if (result.status === "FAILED") {
    return {
      success: false,
      exitCode: result.exitCode ?? 1,
      error: result.error ?? "Semgrep a échoué",
    };
  }

  await ctx.log(
    "info",
    `Semgrep : ${result.vulnerabilityCount} finding(s) — ` +
      `high=${result.severityCounts.high}, medium=${result.severityCounts.medium}`,
  );

  return {
    success: true,
    exitCode: 0,
    data: {
      scanner: "semgrep",
      vulnerabilityCount: result.vulnerabilityCount,
      severityCounts: result.severityCounts,
    },
  };
}