// apps/worker/src/steps/security-gate/security-gate.policy.ts
/**
 * Moteur pur du Security Gate.
 *
 * Il ne dépend ni de Prisma ni de la base : il reçoit des résultats déjà
 * normalisés et une politique figée. Les tests peuvent donc couvrir les
 * décisions sans lancer de scanner.
 */
import {
  GATE_CATEGORIES,
  effectiveGateMode,
  type GateCategory,
  type GateThresholds,
  type SecurityPolicyV1,
} from "@devsecops/shared";

export type GateDecision = "PASSED" | "WARNING" | "BLOCKED";

export type ScanControlState =
  | "SUCCESS_NO_FINDINGS"
  | "SUCCESS_WITH_FINDINGS"
  | "INTERRUPTED"
  | "TIMED_OUT"
  | "SCANNER_UNAVAILABLE"
  | "PARSE_ERROR"
  | "NOT_APPLICABLE"
  | "DISABLED"
  | "REQUIRED_NOT_RUN";

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface GateScan {
  category: GateCategory;
  scanner: string;
  status: string;
  outcome?: string | null;
  counts: SeverityCounts;
}

export interface GateStep {
  name: string;
  type: string;
  status: string;
  resultJson?: unknown;
}

export interface GateVulnerability {
  id: string;
  severity: string;
  fingerprint: string | null;
  reference: string | null;
  status: string;
  category: GateCategory;
  scanner: string;
}

export interface GateException {
  id: string;
  category: string;
  severity: string | null;
  fingerprint: string | null;
  matchType?: string | null;
  status?: string | null;
  reason: string;
  expiresAt: Date | null;
}

export interface AppliedException {
  id: string;
  category: string;
  severity: string | null;
  fingerprint: string | null;
  matchType: string;
  reason: string;
  expiresAt: string | null;
  findingFingerprint?: string | null;
  findingReference?: string | null;
}

export interface TechnicalFailure {
  category: string;
  step: string;
  state: ScanControlState;
  reason: string;
  /** Un contrôle obligatoire non exécuté bloque même en mode WARNING. */
  mandatory: boolean;
}

export interface ControlEvaluation {
  category: string;
  required: boolean;
  mandatory: boolean;
  scannerEnabled: boolean;
  state: ScanControlState;
  reason: string | null;
}

export interface GateEvaluation {
  status: GateDecision;
  mode: "WARNING" | "ENFORCEMENT";
  blocked: boolean;
  reason: string | null;
  counts: SeverityCounts;
  rawCounts: SeverityCounts;
  thresholds: GateThresholds;
  controls: ControlEvaluation[];
  technicalFailures: TechnicalFailure[];
  exceptionsApplied: AppliedException[];
  exceptionsIgnored: Array<{ id: string; reason: string }>;
  policyVersion: number;
}

export interface EvaluateGateInput {
  policy: SecurityPolicyV1;
  scans: GateScan[];
  steps: GateStep[];
  vulnerabilities: GateVulnerability[];
  exceptions: GateException[];
  now?: Date;
}

const STEP_TYPE_BY_CATEGORY: Record<GateCategory, string> = {
  SECRET: "SECRET_SCAN",
  SAST: "SAST",
  SCA: "SCA",
  IMAGE: "IMAGE_SCAN",
  IAC: "IAC_SCAN",
  DAST: "DAST",
};

const SUPPLY_CHAIN_STEPS = [
  { category: "SBOM", type: "SBOM", enabled: "syftEnabled" as const },
  { category: "SIGN", type: "SIGN", enabled: "cosignEnabled" as const },
];

const ACCEPTED_VULNERABILITY_STATUSES = new Set([
  "FALSE_POSITIVE",
  "RISK_ACCEPTED",
  "DUPLICATE",
]);

const FAILURE_STATES = new Set<ScanControlState>([
  "INTERRUPTED",
  "TIMED_OUT",
  "SCANNER_UNAVAILABLE",
  "PARSE_ERROR",
  "REQUIRED_NOT_RUN",
]);

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Vérifie qu'une exception cible exactement CE finding.
 * Aucune exception sans cible, ou liée à une autre catégorie/sévérité, ne
 * doit masquer un résultat.
 */
export function exceptionMatchesFinding(
  exception: GateException,
  finding: Pick<GateVulnerability, "severity" | "fingerprint" | "reference">,
  category: GateCategory,
  now: Date = new Date(),
): boolean {
  const target = normalize(exception.fingerprint);
  if (!target) return false;
  if (exception.status && exception.status !== "APPROVED") return false;
  if (exception.expiresAt && exception.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  if (exception.category !== "ALL" && exception.category !== category) {
    return false;
  }
  if (exception.severity && exception.severity !== finding.severity) {
    return false;
  }

  const matchType = (exception.matchType ?? "ANY").toUpperCase();
  const fingerprintMatches = normalize(finding.fingerprint) === target;
  const referenceMatches = normalize(finding.reference) === target;

  switch (matchType) {
    case "FINGERPRINT":
      return fingerprintMatches;
    case "CVE":
    case "RULE":
    case "REFERENCE":
      return referenceMatches;
    case "ANY":
    default:
      return fingerprintMatches || referenceMatches;
  }
}

function scanOutcome(scan: GateScan | undefined): string | null {
  if (!scan) return null;
  if (scan.outcome) return scan.outcome;
  if (scan.status === "FAILED") return "INTERRUPTED";
  return scan.counts.critical +
    scan.counts.high +
    scan.counts.medium +
    scan.counts.low +
    scan.counts.info >
    0
    ? "SUCCESS_WITH_FINDINGS"
    : "SUCCESS_NO_FINDINGS";
}

function outcomeToState(
  raw: string | null,
  counts: SeverityCounts,
): ScanControlState | null {
  switch ((raw ?? "").toUpperCase()) {
    case "SUCCESS_NO_FINDINGS":
      return "SUCCESS_NO_FINDINGS";
    case "SUCCESS_WITH_FINDINGS":
      return "SUCCESS_WITH_FINDINGS";
    case "INTERRUPTED":
      return "INTERRUPTED";
    case "TIMED_OUT":
      return "TIMED_OUT";
    case "SCANNER_UNAVAILABLE":
      return "SCANNER_UNAVAILABLE";
    case "PARSE_ERROR":
      return "PARSE_ERROR";
    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE";
    case "DISABLED":
      return "DISABLED";
    case "REQUIRED_NOT_RUN":
      return "REQUIRED_NOT_RUN";
    default:
      return null;
  }
}

function resultJsonOf(step: GateStep): Record<string, unknown> {
  return (step.resultJson ?? {}) as Record<string, unknown>;
}

function evaluateCategoryControl(
  category: GateCategory,
  policy: SecurityPolicyV1,
  scans: GateScan[],
  steps: GateStep[],
): ControlEvaluation {
  const categoryPolicy = policy.categories[category];
  const mandatory = categoryPolicy.mandatory;
  const required = categoryPolicy.enabled;

  if (!categoryPolicy.enabled) {
    // Contrôle explicitement désactivé : aucune décision de sécurité n'est
    // prise pour cette catégorie, mais l'état reste visible.
    return {
      category,
      required: false,
      mandatory,
      scannerEnabled: categoryPolicy.scannerEnabled,
      state: "DISABLED",
      reason: "Contrôle facultatif désactivé par la politique",
    };
  }

  if (!categoryPolicy.scannerEnabled) {
    // Un scanner facultatif désactivé est un choix explicite : ce n'est pas
    // un échec technique. En revanche, un contrôle obligatoire dont le
    // scanner est désactivé n'a pas été exécuté et doit être signalé.
    if (!mandatory) {
      return {
        category,
        required,
        mandatory,
        scannerEnabled: false,
        state: "DISABLED",
        reason: "Scanner facultatif désactivé par la politique",
      };
    }
    return {
      category,
      required,
      mandatory,
      scannerEnabled: false,
      state: "REQUIRED_NOT_RUN",
      reason: "Scanner désactivé alors que le contrôle est obligatoire",
    };
  }

  const step = steps.find(
    (candidate) => candidate.type === STEP_TYPE_BY_CATEGORY[category],
  );
  if (!step) {
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state: "REQUIRED_NOT_RUN",
      reason: "Étape de scan absente du pipeline",
    };
  }

  const data = resultJsonOf(step);
  const explicitOutcome = typeof data.outcome === "string" ? data.outcome : null;
  const categoryScans = scans.filter((scan) => scan.category === category);
  const aggregateCounts = categoryScans.reduce(
    (acc, scan) => ({
      critical: acc.critical + scan.counts.critical,
      high: acc.high + scan.counts.high,
      medium: acc.medium + scan.counts.medium,
      low: acc.low + scan.counts.low,
      info: acc.info + scan.counts.info,
    }),
    emptySeverityCounts(),
  );

  if (step.status === "FAILED") {
    const state =
      outcomeToState(explicitOutcome, aggregateCounts) ??
      outcomeToState(scanOutcome(categoryScans[0]), aggregateCounts) ??
      "INTERRUPTED";
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state:
        state === "PARSE_ERROR" || state === "SCANNER_UNAVAILABLE"
          ? state
          : "INTERRUPTED",
      reason:
        typeof data.reason === "string"
          ? data.reason
          : "Le scanner a échoué",
    };
  }
  if (step.status === "TIMED_OUT") {
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state: "TIMED_OUT",
      reason: "Le scanner a dépassé le délai maximal",
    };
  }
  if (
    step.status === "CANCELLED" ||
    step.status === "SECURITY_BLOCKED" ||
    step.status === "SKIPPED"
  ) {
    const state = outcomeToState(explicitOutcome, aggregateCounts);
    if (state === "NOT_APPLICABLE" || state === "DISABLED") {
      return {
        category,
        required,
        mandatory,
        scannerEnabled: true,
        state,
        reason:
          typeof data.reason === "string"
            ? data.reason
            : "Contrôle non applicable",
      };
    }
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state:
        state && FAILURE_STATES.has(state) ? state : "REQUIRED_NOT_RUN",
      reason:
        typeof data.reason === "string"
          ? data.reason
          : "Étape annulée ou non exécutée",
    };
  }
  if (step.status === "WAITING_APPROVAL") {
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state: "REQUIRED_NOT_RUN",
      reason: "Contrôle en attente d'approbation",
    };
  }

  if (data.skipped === true) {
    const technical = data.technical === true;
    const state =
      outcomeToState(explicitOutcome, aggregateCounts) ??
      (technical ? "SCANNER_UNAVAILABLE" : "NOT_APPLICABLE");
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state,
      reason:
        typeof data.reason === "string" ? data.reason : "Contrôle ignoré",
    };
  }

  const scan = categoryScans[0];
  const state =
    outcomeToState(explicitOutcome, aggregateCounts) ??
    outcomeToState(scanOutcome(scan), aggregateCounts);
  if (!state) {
    return {
      category,
      required,
      mandatory,
      scannerEnabled: true,
      state: "PARSE_ERROR",
      reason: "Aucun résultat normalisé exploitable pour ce scanner",
    };
  }
  return {
    category,
    required,
    mandatory,
    scannerEnabled: true,
    state,
    reason: null,
  };
}

function evaluateSupplyChain(steps: GateStep[]): TechnicalFailure[] {
  const failures: TechnicalFailure[] = [];

  for (const item of SUPPLY_CHAIN_STEPS) {
    const step = steps.find((candidate) => candidate.type === item.type);
    if (!step) {
      // Les étapes optionnelles Syft/Cosign ne sont pas des catégories du
      // gate. Leur absence n'est un échec que si elles étaient activées ;
      // la présence de l'étape suffit à les évaluer ici.
      continue;
    }
    const data = resultJsonOf(step);
    if (step.status === "FAILED" || step.status === "TIMED_OUT") {
      failures.push({
        category: item.category,
        step: step.name,
        state: step.status === "TIMED_OUT" ? "TIMED_OUT" : "INTERRUPTED",
        reason:
          typeof data.reason === "string"
            ? data.reason
            : "L'étape a échoué",
        mandatory: false,
      });
    } else if (data.skipped === true && data.technical === true) {
      failures.push({
        category: item.category,
        step: step.name,
        state: "SCANNER_UNAVAILABLE",
        reason:
          typeof data.reason === "string" ? data.reason : "Outil indisponible",
        mandatory: false,
      });
    }
  }
  return failures;
}

export function evaluateSecurityGate(input: EvaluateGateInput): GateEvaluation {
  const { policy } = input;
  const now = input.now ?? new Date();
  const scans = input.scans ?? [];
  const steps = input.steps ?? [];
  const vulnerabilities = input.vulnerabilities ?? [];
  const exceptions = input.exceptions ?? [];
  const mode = effectiveGateMode(policy, now);
  const controls = GATE_CATEGORIES.map((category) =>
    evaluateCategoryControl(category, policy, scans, steps),
  );

  const technicalFailures: TechnicalFailure[] = controls
    .filter((control) => FAILURE_STATES.has(control.state))
    .map((control) => ({
      category: control.category,
      step: STEP_TYPE_BY_CATEGORY[control.category as GateCategory],
      state: control.state,
      reason: control.reason ?? "Contrôle non exécuté",
      mandatory: control.mandatory && control.required,
    }));

  technicalFailures.push(...evaluateSupplyChain(steps));

  const activeExceptions = exceptions.filter(
    (exception) =>
      (!exception.status || exception.status === "APPROVED") &&
      (!exception.expiresAt || exception.expiresAt.getTime() > now.getTime()),
  );
  const ignoredExceptions = exceptions
    .filter((exception) => !activeExceptions.includes(exception))
    .map((exception) => ({
      id: exception.id,
      reason:
        exception.status && exception.status !== "APPROVED"
          ? `Statut ${exception.status}`
          : "Exception expirée",
    }));

  const rawCounts = emptySeverityCounts();
  const counts = emptySeverityCounts();
  const exceptionsApplied: AppliedException[] = [];
  const excludedByScan = new Map<string, SeverityCounts>();
  const scanKey = (category: string, scanner: string): string =>
    `${category}|${scanner}`;

  for (const vulnerability of vulnerabilities) {
    if (!policy.categories[vulnerability.category]?.enabled) continue;
    const key = vulnerability.severity.toLowerCase() as keyof SeverityCounts;
    if (!(key in rawCounts)) continue;

    const exception = activeExceptions.find((candidate) =>
      exceptionMatchesFinding(
        candidate,
        vulnerability,
        vulnerability.category,
        now,
      ),
    );
    const accepted = ACCEPTED_VULNERABILITY_STATUSES.has(vulnerability.status);
    if (!accepted && !exception) continue;

    const bucket =
      excludedByScan.get(scanKey(vulnerability.category, vulnerability.scanner)) ??
      emptySeverityCounts();
    bucket[key] += 1;
    excludedByScan.set(
      scanKey(vulnerability.category, vulnerability.scanner),
      bucket,
    );

    if (exception && !exceptionsApplied.some((item) => item.id === exception.id)) {
      exceptionsApplied.push({
        id: exception.id,
        category: exception.category,
        severity: exception.severity,
        fingerprint: exception.fingerprint,
        matchType: exception.matchType ?? "ANY",
        reason: exception.reason,
        expiresAt: exception.expiresAt?.toISOString() ?? null,
        findingFingerprint: vulnerability.fingerprint,
        findingReference: vulnerability.reference,
      });
    }
  }

  for (const scan of scans) {
    if (!policy.categories[scan.category]?.enabled) continue;
    const excluded =
      excludedByScan.get(scanKey(scan.category, scan.scanner)) ??
      emptySeverityCounts();
    for (const key of Object.keys(rawCounts) as Array<keyof SeverityCounts>) {
      rawCounts[key] += scan.counts[key];
      counts[key] += Math.max(0, scan.counts[key] - excluded[key]);
    }
  }

  const violations: string[] = [];
  const thresholds = policy.thresholds;
  if (counts.critical > thresholds.critical) {
    violations.push(
      `CRITICAL: ${counts.critical} > seuil ${thresholds.critical}`,
    );
  }
  if (counts.high > thresholds.high) {
    violations.push(`HIGH: ${counts.high} > seuil ${thresholds.high}`);
  }
  if (counts.medium > thresholds.medium) {
    violations.push(`MEDIUM: ${counts.medium} > seuil ${thresholds.medium}`);
  }
  if (thresholds.low >= 0 && counts.low > thresholds.low) {
    violations.push(`LOW: ${counts.low} > seuil ${thresholds.low}`);
  }

  const reasons: string[] = [];
  for (const violation of violations) reasons.push(violation);
  for (const failure of technicalFailures) {
    reasons.push(
      `Échec technique ${failure.category} (${failure.step}, ${failure.state}) : ${failure.reason}`,
    );
  }

  const hasIssues = reasons.length > 0;
  // Un contrôle obligatoire non exécuté rend toute décision « réussie »
  // mensongère : il bloque même lorsque le mode est WARNING. Les seuils,
  // eux, ne bloquent qu'en ENFORCEMENT.
  const mandatoryFailures = technicalFailures.filter(
    (failure) => failure.mandatory,
  );
  const status: GateDecision = !hasIssues
    ? "PASSED"
    : mode === "ENFORCEMENT" || mandatoryFailures.length > 0
      ? "BLOCKED"
      : "WARNING";

  const reason =
    reasons.length === 0
      ? null
      : mandatoryFailures.length > 0 && mode !== "ENFORCEMENT"
        ? `Contrôle obligatoire non exécuté — ${reasons.join(" | ")}`
        : reasons.join(" | ");

  return {
    status,
    mode,
    blocked: status === "BLOCKED",
    reason,
    counts,
    rawCounts,
    thresholds,
    controls,
    technicalFailures,
    exceptionsApplied,
    exceptionsIgnored: ignoredExceptions,
    policyVersion: policy.version,
  };
}
