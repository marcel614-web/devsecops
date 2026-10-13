// apps/worker/src/orchestrator/scanner.helper.ts
import { ScanType, Severity, StepStatus } from "@prisma/client";
import type { ScanResult } from "@devsecops/scanners";
import { prisma } from "../utils/prisma";

interface PersistContext {
  pipelineId: string;
  projectId: string;
  stepId: string;
  type: ScanType;
}

/**
 * Persiste un ScanResult en base : crée un SecurityScan,
 * puis un Vulnerability par finding normalisé.
 * Met à jour les compteurs de sévérité sur SecurityScan.
 */
export async function persistScanResult(
  ctx: PersistContext,
  result: ScanResult,
): Promise<void> {
  const scan = await prisma.securityScan.create({
    data: {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      scanner: result.scanner,
      type: ctx.type,
      status: result.status === "SUCCESS" ? StepStatus.SUCCESS : StepStatus.FAILED,
      criticalCount: result.severityCounts.critical,
      highCount: result.severityCounts.high,
      mediumCount: result.severityCounts.medium,
      lowCount: result.severityCounts.low,
      infoCount: result.severityCounts.info,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      startedAt: new Date(Date.now() - result.durationMs),
      finishedAt: new Date(),
      rawResultJson: {
        scanner: result.scanner,
        status: result.status,
        vulnerabilityCount: result.vulnerabilityCount,
      },
    },
    select: { id: true },
  });

  if (result.findings.length > 0) {
    await prisma.vulnerability.createMany({
      data: result.findings.map((f) => ({
        scanId: scan.id,
        tool: f.tool,
        technology: f.technology,
        severity: f.severity as Severity,
        packageName: f.packageName,
        filePath: f.filePath,
        version: f.version,
        fixedVersion: f.fixedVersion,
        description: f.description,
        reference: f.reference,
      })),
    });
  }
}