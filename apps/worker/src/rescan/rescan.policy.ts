// apps/worker/src/rescan/rescan.policy.ts

export const SUPPORTED_RESCAN_CONTROLS = ["IMAGE"] as const;
export type SupportedRescanControl = (typeof SUPPORTED_RESCAN_CONTROLS)[number];

export function normalizeRescanControls(values: string[] | null | undefined): string[] {
  const supported = new Set<string>(SUPPORTED_RESCAN_CONTROLS);
  return [...new Set((values ?? []).map((value) => value.trim().toUpperCase()))]
    .filter((value) => supported.has(value));
}

export function computeNextRescanAt(
  from: Date,
  intervalHours: number,
  now: Date = new Date(),
): Date {
  const interval = Math.max(1, Math.min(24 * 30, intervalHours));
  return new Date(
    Math.max(now.getTime(), from.getTime()) + interval * 3_600_000,
  );
}

export function isRescanDue(
  nextRunAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return !!nextRunAt && nextRunAt.getTime() <= now.getTime();
}

export function dailyLimitReached(
  runsLast24h: number,
  maxRunsPerDay: number,
): boolean {
  return runsLast24h >= Math.max(1, maxRunsPerDay);
}

/** Clé de cycle stable : une échéance planifiée = un seul rescan/version. */
export function cycleKeyFor(nextRunAt: Date): string {
  return nextRunAt.toISOString();
}
