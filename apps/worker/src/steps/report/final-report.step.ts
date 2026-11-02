// apps/worker/src/steps/report/final-report.step.ts
import { prisma } from "../../utils/prisma";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  writeReportFiles,
  type ReportSummary,
  type ReportTopFinding,
} from "./report.generator";

interface ScanSummary {
  scanner: string;
  status: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  durationMs: number | null;
}

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export async function finalReportStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Génération du rapport de sécurité...");

  // 1. Charge le pipeline + projet.
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: ctx.pipelineId },
    include: {
      project: {
        select: { id: true, name: true, repoFullName: true, technology: true },
      },
      gateResult: true,
      gateEvaluations: { orderBy: { evaluatedAt: "asc" } },
      securityPolicy: true,
      steps: { select: { status: true, resultJson: true } },
      dockerImage: true,
      deployment: true,
      sbom: true,
    },
  });
  if (!pipeline) {
    return { success: false, exitCode: 1, error: "Pipeline introuvable" };
  }

  // 2. Tous les scans.
  const scans = await prisma.securityScan.findMany({
    where: { pipelineId: ctx.pipelineId },
    orderBy: { createdAt: "asc" },
    select: {
      scanner: true,
      status: true,
      criticalCount: true,
      highCount: true,
      mediumCount: true,
      lowCount: true,
      infoCount: true,
      durationMs: true,
    },
  });

  const scanSummaries: ScanSummary[] = scans.map((s) => ({
    scanner: s.scanner,
    status: s.status,
    critical: s.criticalCount,
    high: s.highCount,
    medium: s.mediumCount,
    low: s.lowCount,
    info: s.infoCount,
    durationMs: s.durationMs,
  }));

  // 3. Totaux consolidés.
  const totals = scanSummaries.reduce(
    (acc, s) => ({
      critical: acc.critical + s.critical,
      high: acc.high + s.high,
      medium: acc.medium + s.medium,
      low: acc.low + s.low,
      info: acc.info + s.info,
    }),
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  );

  // 4. Top 20 vulnérabilités triées par sévérité.
  const allVulns = await prisma.vulnerability.findMany({
    where: { scan: { pipelineId: ctx.pipelineId } },
    select: {
      tool: true,
      severity: true,
      packageName: true,
      filePath: true,
      description: true,
      reference: true,
    },
  });

  const topFindings: ReportTopFinding[] = allVulns
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 99;
      const sb = SEVERITY_ORDER[b.severity] ?? 99;
      return sa - sb;
    })
    .slice(0, 20);

  // 5. Durée totale du pipeline (le rapport est généré avant que le
  //    moteur ne positionne finishedAt : on utilise l'instant courant).
  const finishedAt = pipeline.finishedAt ?? new Date();
  const durationMs = pipeline.startedAt
    ? finishedAt.getTime() - pipeline.startedAt.getTime()
    : null;

  // Statut final estimé : le moteur met à jour le pipeline juste après
  // cette étape, mais le rapport doit refléter la réalité. On ne présente
  // jamais un timeout ou des avertissements comme un succès total.
  const hasTimeout = pipeline.steps.some((step) => step.status === "TIMED_OUT");
  const hasWarnings =
    pipeline.steps.some(
      (step) =>
        step.status === "SUCCESS_WITH_WARNINGS" ||
        (step.status === "SKIPPED" &&
          (step.resultJson as { technical?: boolean } | null)?.technical ===
            true),
    ) ||
    pipeline.gateResult?.status === "WARNING" ||
    pipeline.gateEvaluations.some((gate) => gate.status === "WARNING");
  const reportStatus =
    ctx.pipelineSecurityBlocked || pipeline.gateResult?.blocked
      ? "SECURITY_BLOCKED"
      : hasTimeout
        ? "TIMED_OUT"
        : ctx.pipelineAborted
          ? "FAILED"
          : hasWarnings
            ? "SUCCESS_WITH_WARNINGS"
            : "SUCCESS";

  // 6. Construit le résumé JSON.
  const summary: ReportSummary = {
    generatedAt: new Date().toISOString(),
    project: {
      id: pipeline.project.id,
      name: pipeline.project.name,
      repoFullName: pipeline.project.repoFullName,
      technology: pipeline.project.technology,
    },
    pipeline: {
      id: pipeline.id,
      commitSha: pipeline.commitSha,
      branch: pipeline.branch,
      author: pipeline.author,
      trigger: pipeline.trigger,
      status: reportStatus,
      startedAt: pipeline.startedAt?.toISOString() ?? null,
      finishedAt: finishedAt.toISOString(),
      durationMs,
      pullRequestNumber: pipeline.pullRequestNumber,
    },
    scans: scanSummaries,
    totals,
    gate: pipeline.gateResult
      ? {
          status: pipeline.gateResult.status,
          mode: pipeline.gateResult.mode,
          blocked: pipeline.gateResult.blocked,
          reason: pipeline.gateResult.reason,
          rules: pipeline.gateResult.rulesJson,
        }
      : null,
    securityPolicy: pipeline.securityPolicy
      ? {
          version: pipeline.securityPolicy.version,
          policyHash: pipeline.securityPolicy.policyHash,
          mode: (
            pipeline.securityPolicy.policyJson as {
              mode?: string;
            }
          ).mode ?? "WARNING",
          enforcementAt:
            (
              pipeline.securityPolicy.policyJson as {
                enforcementAt?: string | null;
              }
            ).enforcementAt ?? null,
        }
      : null,
    gates: pipeline.gateEvaluations.map((gate) => ({
      gateKey: gate.gateKey,
      status: gate.status,
      mode: gate.mode,
      blocked: gate.blocked,
      reason: gate.reason,
      evaluatedAt: gate.evaluatedAt.toISOString(),
    })),
    dockerImage: pipeline.dockerImage
      ? {
          imageTag: pipeline.dockerImage.imageTag,
          imageId: pipeline.dockerImage.imageId,
          signed: pipeline.dockerImage.signed,
        }
      : null,
    sbom: pipeline.sbom
      ? {
          packageCount: pipeline.sbom.packageCount,
          format: pipeline.sbom.format,
        }
      : null,
    deployment: pipeline.deployment
      ? {
          status: pipeline.deployment.status,
          environment: pipeline.deployment.environment,
          url: pipeline.deployment.url,
          releaseVersion: pipeline.deployment.releaseVersion,
        }
      : null,
    topFindings,
    vulnerabilityCount: allVulns.length,
  };

  // 7. Génère les fichiers HTML et PDF.
  let htmlPath: string | null = null;
  let pdfPath: string | null = null;
  try {
    const files = await writeReportFiles(summary, ctx.pipelineId);
    htmlPath = files.htmlPath;
    pdfPath = files.pdfPath;
    await ctx.log("info", `Rapport HTML : ${htmlPath}`);
    await ctx.log("info", `Rapport PDF : ${pdfPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("warn", `Génération des fichiers de rapport échouée : ${msg}`);
  }

  // 8. Upsert du rapport.
  await prisma.securityReport.upsert({
    where: { pipelineId: ctx.pipelineId },
    create: {
      pipelineId: ctx.pipelineId,
      projectId: pipeline.project.id,
      summaryJson: summary as unknown as object,
      htmlPath,
      pdfPath,
    },
    update: {
      summaryJson: summary as unknown as object,
      htmlPath,
      pdfPath,
    },
  });

  await ctx.log(
    "info",
    `Rapport généré : ${scanSummaries.length} scanner(s), ` +
      `${allVulns.length} vulnérabilité(s) — ` +
      `C=${totals.critical} H=${totals.high} M=${totals.medium} L=${totals.low}`,
  );

  if (pipeline.gateResult) {
    await ctx.log(
      "info",
      `Security Gate : ${pipeline.gateResult.status}` +
        (pipeline.gateResult.reason ? ` (${pipeline.gateResult.reason})` : ""),
    );
  }

  return {
    success: true,
    exitCode: 0,
    data: {
      report: "generated",
      htmlPath,
      pdfPath,
      scanners: scanSummaries.length,
      vulnerabilities: allVulns.length,
      totals,
    },
  };
}
