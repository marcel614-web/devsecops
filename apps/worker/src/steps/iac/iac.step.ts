// apps/worker/src/steps/iac/iac.step.ts
import { ScanType } from "@prisma/client";
import { TrivyScanner } from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { persistScanResult } from "../../orchestrator/scanner.helper";

const scanner = new TrivyScanner();

/**
 * Scan Infrastructure as Code (Dockerfile, Kubernetes, Terraform, etc.)
 * via `trivy config`.
 */
export async function iacStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Vérification de la disponibilité de Trivy (config)...");

  if (!(await scanner.isAvailable())) {
    await ctx.log(
      "warn",
      "Trivy non installé — scan IaC ignoré (échec technique signalé au Security Gate)",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, technical: true, reason: "trivy not found" },
    };
  }

  await ctx.log("info", "Analyse des fichiers IaC (Trivy config)...");

  const result = await scanner.scanConfig({
    workspaceDir: ctx.workspaceDir,
    onLog: ctx.log,
  });

  for (const line of result.logs) {
    const level = line.startsWith("[error]")
      ? "error"
      : line.startsWith("[warn]")
        ? "warn"
        : "info";
    await ctx.log(level, line);
  }

  await persistScanResult(
    {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      stepId: ctx.stepId,
      type: ScanType.IAC,
    },
    result,
  );

  if (result.status === "FAILED") {
    return {
      success: false,
      exitCode: result.exitCode ?? 1,
      error: result.error ?? "Trivy config a échoué",
    };
  }

  return {
    success: true,
    exitCode: 0,
    data: {
      scanner: "trivy-config",
      vulnerabilityCount: result.vulnerabilityCount,
      severityCounts: result.severityCounts,
    },
  };
}
