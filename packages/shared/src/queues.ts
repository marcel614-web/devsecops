// packages/shared/src/queues.ts
/**
 * Noms et contrats des jobs BullMQ partagés entre l'API et le worker.
 *
 * Le rescan utilise la même infrastructure Redis/BullMQ que les pipelines :
 * un seul mécanisme de planification (job scheduler BullMQ), pas un second
 * ordonnanceur.
 */

export const RESCAN_QUEUE_NAME = "rescan-runs";
export const RESCAN_SCHEDULER_ID = "rescan-scheduler";
export const RESCAN_TICK_JOB = "tick";
export const RESCAN_RUN_JOB = "run";

export interface RescanTickJobData {
  /** Laissé vide : le tick balaie les politiques arrivées à échéance. */
  readonly kind?: "tick";
}

export interface RescanRunJobData {
  rescanRunId: string;
}

export type RescanJobData = RescanTickJobData | RescanRunJobData;

export function isRescanRunJobData(
  data: RescanJobData,
): data is RescanRunJobData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as RescanRunJobData).rescanRunId === "string"
  );
}
