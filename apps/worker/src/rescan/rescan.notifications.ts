// apps/worker/src/rescan/rescan.notifications.ts
import { NotificationKind } from "@prisma/client";
import type { RescanComparison } from "./rescan.comparison";

export interface RescanNotificationContent {
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
  sourceKey: string;
}

export function buildRescanRiskNotification(params: {
  projectId: string;
  projectName: string;
  rescanRunId: string;
  commitSha: string;
  imageTag: string | null;
  comparison: RescanComparison;
}): RescanNotificationContent | null {
  const { comparison } = params;
  if (!comparison.riskFound) return null;

  const newCriticalHigh =
    comparison.counts.newBySeverity.CRITICAL +
    comparison.counts.newBySeverity.HIGH;
  const dangerous =
    newCriticalHigh > 0 || comparison.counts.increasedToHighOrCritical > 0;

  const shortSha = params.commitSha.slice(0, 8);
  const parts = [
    `${comparison.counts.new} nouveau(x) résultat(s)`,
    `${comparison.counts.severityIncreased} sévérité(s) aggravée(s)`,
    `${comparison.counts.resolved} résolu(s)`,
  ];

  return {
    kind: dangerous ? NotificationKind.DANGER : NotificationKind.WARNING,
    title: dangerous
      ? `Rescan : risque critique/high sur ${params.projectName}`
      : `Rescan : évolution des risques sur ${params.projectName}`,
    message:
      `Version ${params.imageTag ?? shortSha} (${shortSha}) — ` +
      `${parts.join(", ")}. Aucun redéploiement automatique n'a été déclenché.`,
    link: `/projects/${params.projectId}?tab=resilience&rescan=${params.rescanRunId}`,
    sourceKey: `rescan-risk:${params.rescanRunId}`,
  };
}

export function buildRescanFailureNotification(params: {
  projectId: string;
  projectName: string;
  rescanRunId: string;
  imageTag: string | null;
  error: string;
}): RescanNotificationContent {
  return {
    kind: NotificationKind.WARNING,
    title: `Rescan en échec sur ${params.projectName}`,
    message:
      `La réévaluation de ${params.imageTag ?? "l'artefact déployé"} n'a pas abouti : ` +
      `${params.error.slice(0, 500)}`,
    link: `/projects/${params.projectId}?tab=resilience&rescan=${params.rescanRunId}`,
    sourceKey: `rescan-failed:${params.rescanRunId}`,
  };
}
