// apps/worker/src/orchestrator/scan-triage.ts
import { ScanType, VulnerabilityStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";

/**
 * Champs de triage à conserver quand une étape de scan est reprise.
 *
 * Une reprise supprime l'ancien SecurityScan (sinon le Security Gate
 * compterait deux fois les mêmes findings). Sans snapshot, la suppression
 * cascade sur les Vulnerability et détruit le travail de triage :
 * faux positif, risque accepté, assignation, notes, échéance.
 */
export interface TriageSnapshot {
  fingerprint: string;
  status: VulnerabilityStatus;
  assignedToId: string | null;
  notes: string | null;
  dueDate: Date | null;
}

const TRIAGE_STATUSES = new Set<VulnerabilityStatus>([
  VulnerabilityStatus.FALSE_POSITIVE,
  VulnerabilityStatus.RISK_ACCEPTED,
  VulnerabilityStatus.DUPLICATE,
  VulnerabilityStatus.CONFIRMED,
]);

/**
 * Vrai si le finding porte une information de triage qui doit survivre à
 * une reprise. Un finding OPEN sans assignation ni note n'a rien à sauver.
 */
export function hasTriageInformation(row: {
  status: VulnerabilityStatus;
  assignedToId: string | null;
  notes: string | null;
  dueDate: Date | null;
}): boolean {
  return (
    TRIAGE_STATUSES.has(row.status) ||
    row.assignedToId !== null ||
    (row.notes !== null && row.notes.trim() !== "") ||
    row.dueDate !== null
  );
}

/**
 * Sauvegarde le triage des findings de l'ancien scan, puis supprime ce scan.
 *
 * @returns les snapshots à restaurer après l'exécution du nouveau scan
 */
export async function snapshotAndClearScan(
  pipelineId: string,
  type: ScanType,
): Promise<TriageSnapshot[]> {
  const scans = await prisma.securityScan.findMany({
    where: { pipelineId, type },
    select: {
      id: true,
      vulnerabilities: {
        select: {
          fingerprint: true,
          status: true,
          assignedToId: true,
          notes: true,
          dueDate: true,
        },
      },
    },
  });

  if (scans.length === 0) return [];

  // Plusieurs scans du même type ne devraient pas exister, mais on
  // déduplique par fingerprint en gardant le triage le plus informatif.
  const byFingerprint = new Map<string, TriageSnapshot>();
  for (const scan of scans) {
    for (const vuln of scan.vulnerabilities) {
      if (!vuln.fingerprint) continue;
      if (!hasTriageInformation(vuln)) continue;
      if (byFingerprint.has(vuln.fingerprint)) continue;

      byFingerprint.set(vuln.fingerprint, {
        fingerprint: vuln.fingerprint,
        status: vuln.status,
        assignedToId: vuln.assignedToId,
        notes: vuln.notes,
        dueDate: vuln.dueDate,
      });
    }
  }

  await prisma.securityScan.deleteMany({
    where: { id: { in: scans.map((scan) => scan.id) } },
  });

  return [...byFingerprint.values()];
}

/**
 * Réapplique le triage sauvegardé sur les nouveaux findings.
 *
 * @returns le nombre de lignes mises à jour
 */
export async function restoreScanTriage(
  pipelineId: string,
  type: ScanType,
  snapshots: TriageSnapshot[],
): Promise<number> {
  let updated = 0;

  for (const snapshot of snapshots) {
    const result = await prisma.vulnerability.updateMany({
      where: {
        scan: { pipelineId, type },
        fingerprint: snapshot.fingerprint,
      },
      data: {
        status: snapshot.status,
        assignedToId: snapshot.assignedToId,
        notes: snapshot.notes,
        dueDate: snapshot.dueDate,
      },
    });
    updated += result.count;
  }

  return updated;
}
