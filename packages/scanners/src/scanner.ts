// packages/scanners/src/scanner.ts
export type ScannerSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ScannerStatus = "SUCCESS" | "FAILED";

export type ScannerOutcome =
  | "SUCCESS_NO_FINDINGS"
  | "SUCCESS_WITH_FINDINGS"
  | "INTERRUPTED"
  | "SCANNER_UNAVAILABLE"
  | "PARSE_ERROR"
  | "NOT_APPLICABLE"
  | "DISABLED"
  | "REQUIRED_NOT_RUN";

export interface NormalizedFinding {
  tool: string;
  technology?: string;
  severity: ScannerSeverity;
  packageName?: string;
  filePath?: string;
  version?: string;
  fixedVersion?: string;
  description?: string;
  reference?: string;
  raw?: unknown;
}

export interface ScanSeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ScanResult {
  scanner: string;
  status: ScannerStatus;
  /** Issue normalisée, notamment pour distinguer parse error et interruption. */
  outcome?: ScannerOutcome;
  durationMs: number;
  exitCode: number | null;
  /** Version de l'outil réellement exécutée, si disponible. */
  scannerVersion?: string;
  vulnerabilityCount: number;
  severityCounts: ScanSeverityCounts;
  findings: NormalizedFinding[];
  logs: string[];
  error?: string;
}

export interface ScanContext {
  workspaceDir: string;
  /** URL cible pour les scanners dynamiques (DAST). */
  targetUrl?: string;
  onLog?: (
    level: "info" | "warn" | "error" | "debug",
    message: string,
  ) => Promise<void>;
}

export interface SecurityScanner {
  readonly name: string;
  isAvailable(workspaceDir?: string): Promise<boolean>;
  scan(ctx: ScanContext): Promise<ScanResult>;
  /** Dernière version observée par isAvailable, si l'outil l'expose. */
  getVersion?(): string | null;
}