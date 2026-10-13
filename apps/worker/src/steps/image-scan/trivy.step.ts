// apps/worker/src/steps/image-scan/trivy.step.ts
import { ScanType } from "@prisma/client";
import { TrivyScanner } from "@devsecops/scanners";
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { persistScanResult } from "../../orchestrator/scanner.helper";

const scanner = new TrivyScanner();

export async function trivyStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  // 1. Récupère l'image buildée pour ce pipeline.
  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { imageTag: true },
  });

  if (!image) {
    await ctx.log("warn", "Aucune image Docker associée — étape Trivy ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no docker image built" },
    };
  }

  // 2. Vérifie Trivy.
  await ctx.log("info", "Vérification de la disponibilité de Trivy...");
  if (!(await scanner.isAvailable())) {
    await ctx.log("warn", "Trivy non installé — étape ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "trivy not found" },
    };
  }

  // 3. Scanne.
  await ctx.log("info", `Scan de l'image ${image.imageTag} avec Trivy...`);
  const result = await scanner.scanImage({
    workspaceDir: ctx.workspaceDir,
    imageTag: image.imageTag,
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

  // 4. Persiste.
  await persistScanResult(
    {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      stepId: ctx.stepId,
      type: ScanType.IMAGE,
    },
    result,
  );

  if (result.status === "FAILED") {
    return {
      success: false,
      exitCode: result.exitCode ?? 1,
      error: result.error ?? "Trivy a échoué",
    };
  }

  await ctx.log(
    "info",
    `Trivy : ${result.vulnerabilityCount} vulnérabilité(s) — ` +
      `critical=${result.severityCounts.critical}, high=${result.severityCounts.high}`,
  );

  return {
    success: true,
    exitCode: 0,
    data: {
      scanner: "trivy",
      vulnerabilityCount: result.vulnerabilityCount,
      severityCounts: result.severityCounts,
    },
  };
}