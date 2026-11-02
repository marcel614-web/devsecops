// apps/worker/src/rescan/rescan.comparison.ts
import type { Severity } from "@prisma/client";

export interface RescanFinding {
  fingerprint: string;
  severity: Severity;
  tool: string;
  packageName?: string | null;
  filePath?: string | null;
  reference?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface SeverityChange {
  fingerprint: string;
  tool: string;
  packageName: string | null;
  reference: string | null;
  filePath: string | null;
  previousSeverity: Severity;
  currentSeverity: Severity;
  direction: "INCREASED" | "DECREASED";
}

export interface RescanComparison {
  baselineAvailable: boolean;
  baselineFingerprints: number;
  currentFingerprints: number;
  newFindings: RescanFinding[];
  resolvedFindings: RescanFinding[];
  severityChanges: SeverityChange[];
  counts: {
    new: number;
    resolved: number;
    severityIncreased: number;
    severityDecreased: number;
    newBySeverity: Record<Severity, number>;
    increasedToHighOrCritical: number;
  };
  /** Vrai si un risque nouveau ou aggravé doit déclencher une notification. */
  riskFound: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

function emptySeverityCounts(): Record<Severity, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
}

function byFingerprint(findings: RescanFinding[]): Map<string, RescanFinding> {
  const map = new Map<string, RescanFinding>();
  for (const finding of findings) {
    if (!finding.fingerprint) continue;
    const previous = map.get(finding.fingerprint);
    if (
      !previous ||
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[previous.severity]
    ) {
      map.set(finding.fingerprint, finding);
    }
  }
  return map;
}

function accepted(status: string | null | undefined): boolean {
  return (
    status === "FALSE_POSITIVE" ||
    status === "RISK_ACCEPTED" ||
    status === "DUPLICATE"
  );
}

/**
 * Compare un scan actuel à la baseline (rescan précédent ou scan image du
 * pipeline déployé). Aucune ligne d'historique n'est supprimée : le rapport
 * décrit uniquement l'évolution.
 */
export function compareRescanFindings(
  baseline: RescanFinding[],
  current: RescanFinding[],
  options: { baselineAvailable: boolean },
): RescanComparison {
  const previous = byFingerprint(baseline);
  const now = byFingerprint(current);
  const newBySeverity = emptySeverityCounts();

  const newFindings: RescanFinding[] = [];
  const severityChanges: SeverityChange[] = [];
  let increasedToHighOrCritical = 0;

  for (const [fingerprint, finding] of now) {
    const old = previous.get(fingerprint);
    if (!old) {
      // Une première baseline absente ne permet pas de qualifier un finding
      // de « nouveau » : on évite une alerte trompeuse.
      if (options.baselineAvailable) {
        newFindings.push(finding);
        newBySeverity[finding.severity]++;
      }
      continue;
    }

    if (old.severity !== finding.severity) {
      const direction =
        SEVERITY_RANK[finding.severity] > SEVERITY_RANK[old.severity]
          ? "INCREASED"
          : "DECREASED";
      severityChanges.push({
        fingerprint,
        tool: finding.tool,
        packageName: finding.packageName ?? null,
        reference: finding.reference ?? null,
        filePath: finding.filePath ?? null,
        previousSeverity: old.severity,
        currentSeverity: finding.severity,
        direction,
      });
      if (
        direction === "INCREASED" &&
        (finding.severity === "CRITICAL" || finding.severity === "HIGH")
      ) {
        increasedToHighOrCritical++;
      }
    }
  }

  const resolvedFindings: RescanFinding[] = [];
  for (const [fingerprint, finding] of previous) {
    if (!now.has(fingerprint)) {
      resolvedFindings.push(finding);
    }
  }

  const severityIncreased = severityChanges.filter(
    (change) => change.direction === "INCREASED",
  ).length;
  const severityDecreased = severityChanges.filter(
    (change) => change.direction === "DECREASED",
  ).length;

  const riskFound =
    options.baselineAvailable &&
    (newFindings.some((finding) => !accepted(finding.status)) ||
      increasedToHighOrCritical > 0);

  return {
    baselineAvailable: options.baselineAvailable,
    baselineFingerprints: previous.size,
    currentFingerprints: now.size,
    newFindings,
    resolvedFindings,
    severityChanges,
    counts: {
      new: newFindings.length,
      resolved: resolvedFindings.length,
      severityIncreased,
      severityDecreased,
      newBySeverity,
      increasedToHighOrCritical,
    },
    riskFound,
  };
}
