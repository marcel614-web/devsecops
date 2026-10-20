// apps/worker/src/orchestrator/scanner.helper.ts
import crypto from "node:crypto";
import {
  ScanType,
  Severity,
  StepStatus,
  VulnerabilityStatus,
} from "@prisma/client";
import type { NormalizedFinding, ScanResult } from "@devsecops/scanners";
import { prisma } from "../utils/prisma";

interface PersistContext {
  pipelineId: string;
  projectId: string;
  stepId: string;
  type: ScanType;
}

/**
 * Empreinte stable d'un finding, utilisée pour la déduplication
 * (comportement inspiré de DefectDojo).
 *
 * On n'inclut volontairement pas la sévérité : si un scanner requalifie
 * un finding, on veut le retrouver comme le même problème.
 */
export function fingerprintFinding(
  projectId: string,
  finding: NormalizedFinding,
): string {
  const norm = (value: string | undefined | null): string =>
    (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  const source = [
    projectId,
    norm(finding.tool),
    norm(finding.packageName),
    norm(finding.filePath),
    // La référence (CVE, règle Semgrep…) est le discriminant le plus
    // stable. À défaut, on utilise la description : indispensable pour
    // les secrets, où packageName et reference sont souvent vides.
    norm(finding.reference) || norm(finding.description).slice(0, 300),
  ].join("|");

  return crypto.createHash("sha256").update(source).digest("hex");
}

const INHERITED_STATUSES: VulnerabilityStatus[] = [
  VulnerabilityStatus.FALSE_POSITIVE,
  VulnerabilityStatus.RISK_ACCEPTED,
  VulnerabilityStatus.DUPLICATE,
  VulnerabilityStatus.CONFIRMED,
];

/**
 * Persiste un ScanResult en base : crée un SecurityScan,
 * puis un Vulnerability par finding normalisé.
 *
 * Les findings sont dédupliqués par empreinte au niveau du projet :
 *  - firstSeenAt / lastSeenAt / occurrences sont mis à jour ;
 *  - un statut FALSE_POSITIVE / RISK_ACCEPTED / DUPLICATE / CONFIRMED
 *    est propagé à la nouvelle occurrence ;
 *  - un finding FIXED qui réapparaît repasse en OPEN.
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
        logs: result.logs.slice(-50),
        error: result.error ?? null,
      },
    },
    select: { id: true },
  });

  if (result.findings.length === 0) return;

  const now = new Date();
  const fingerprints = result.findings.map((f) =>
    fingerprintFinding(ctx.projectId, f),
  );

  // Charge une seule fois les occurrences existantes du projet.
  const existing = await prisma.vulnerability.findMany({
    where: {
      scan: { projectId: ctx.projectId },
      fingerprint: { in: fingerprints },
    },
    orderBy: { detectedAt: "desc" },
    select: {
      fingerprint: true,
      status: true,
      firstSeenAt: true,
    },
  });

  const existingByFingerprint = new Map<
    string,
    { status: VulnerabilityStatus; firstSeenAt: Date }
  >();
  for (const row of existing) {
    if (!row.fingerprint) continue;
    if (!existingByFingerprint.has(row.fingerprint)) {
      existingByFingerprint.set(row.fingerprint, {
        status: row.status,
        firstSeenAt: row.firstSeenAt,
      });
    }
  }

  const data = result.findings.map((f, index) => {
    const fingerprint = fingerprints[index];
    const previous = existingByFingerprint.get(fingerprint);

    let status: VulnerabilityStatus = VulnerabilityStatus.OPEN;
    if (previous && INHERITED_STATUSES.includes(previous.status)) {
      status = previous.status;
    }

    return {
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
      fingerprint,
      status,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
      occurrences: 1,
    };
  });

  await prisma.vulnerability.createMany({ data });

  // Met à jour les compteurs de déduplication pour tous les findings
  // partageant les mêmes empreintes.
  const uniqueFingerprints = [...new Set(fingerprints)];
  const groups = await prisma.vulnerability.groupBy({
    by: ["fingerprint"],
    where: {
      scan: { projectId: ctx.projectId },
      fingerprint: { in: uniqueFingerprints },
    },
    _count: { _all: true },
    _min: { firstSeenAt: true },
  });

  for (const group of groups) {
    if (!group.fingerprint) continue;
    await prisma.vulnerability.updateMany({
      where: {
        fingerprint: group.fingerprint,
        scan: { projectId: ctx.projectId },
      },
      data: {
        occurrences: group._count._all,
        firstSeenAt: group._min.firstSeenAt ?? now,
        lastSeenAt: now,
      },
    });
  }
}
