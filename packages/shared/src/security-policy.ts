// packages/shared/src/security-policy.ts
/**
 * Politique de sécurité normalisée, indépendante de la syntaxe propre à
 * chaque scanner.
 *
 * Ce module ne dépend ni de Prisma ni de l'API : il est utilisé par l'API
 * pour figer la politique d'un pipeline, et par le worker pour l'évaluer.
 */
import crypto from "node:crypto";

export const GATE_CATEGORIES = [
  "SECRET",
  "SAST",
  "SCA",
  "IMAGE",
  "IAC",
  "DAST",
] as const;

export type GateCategory = (typeof GATE_CATEGORIES)[number];
export type GateMode = "WARNING" | "ENFORCEMENT";

export const DEFAULT_MANDATORY_CONTROLS: GateCategory[] = ["SECRET", "SCA"];

export interface GateThresholds {
  /** Nombre maximum autorisé. 0 = interdit. */
  critical: number;
  high: number;
  medium: number;
  low: number; // -1 = illimité
}

export interface GateCategoryPolicy {
  /** Le résultat de cette catégorie est évalué par le gate. */
  enabled: boolean;
  /** Le scanner correspondant est planifié dans le pipeline. */
  scannerEnabled: boolean;
  /** Contrôle protégé : sa désactivation est réservée à un ADMIN. */
  mandatory: boolean;
}

export interface SecurityPolicyV1 {
  schemaVersion: 1;
  /** Version de la politique du projet au moment du déclenchement. */
  version: number;
  mode: GateMode;
  enforcementAt: string | null;
  thresholds: GateThresholds;
  categories: Record<GateCategory, GateCategoryPolicy>;
  requireExceptionApproval: boolean;
}

export interface SecurityPolicySource {
  securityGateCritical: number;
  securityGateHigh: number;
  securityGateMedium: number;
  securityGateLow: number;
  gateMode: string;
  gateEnforcementAt: Date | string | null;
  gateSecretsEnabled: boolean;
  gateSastEnabled: boolean;
  gateScaEnabled: boolean;
  gateImageEnabled: boolean;
  gateIacEnabled: boolean;
  gateDastEnabled: boolean;
  gitleaksEnabled: boolean;
  semgrepEnabled: boolean;
  scaEnabled: boolean;
  trivyEnabled: boolean;
  iacEnabled: boolean;
  zapEnabled: boolean;
  mandatoryControls?: string[] | null;
  requireExceptionApproval?: boolean | null;
  policyVersion?: number | null;
}

const CATEGORY_SOURCE_KEYS: Record<
  GateCategory,
  { gate: keyof SecurityPolicySource; scanner: keyof SecurityPolicySource }
> = {
  SECRET: { gate: "gateSecretsEnabled", scanner: "gitleaksEnabled" },
  SAST: { gate: "gateSastEnabled", scanner: "semgrepEnabled" },
  SCA: { gate: "gateScaEnabled", scanner: "scaEnabled" },
  IMAGE: { gate: "gateImageEnabled", scanner: "trivyEnabled" },
  IAC: { gate: "gateIacEnabled", scanner: "iacEnabled" },
  DAST: { gate: "gateDastEnabled", scanner: "zapEnabled" },
};

export function isGateCategory(value: string): value is GateCategory {
  return (GATE_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeMandatoryControls(
  values: string[] | null | undefined,
): GateCategory[] {
  if (!values) return [...DEFAULT_MANDATORY_CONTROLS];
  const result = new Set<GateCategory>();
  for (const value of values) {
    const normalized = value.trim().toUpperCase();
    if (isGateCategory(normalized)) result.add(normalized);
  }
  return [...result];
}

/**
 * Construit une politique immuable et normalisée à partir de la config.
 */
export function buildSecurityPolicy(config: SecurityPolicySource): SecurityPolicyV1 {
  const mandatory = new Set(normalizeMandatoryControls(config.mandatoryControls));
  const categories = {} as Record<GateCategory, GateCategoryPolicy>;

  for (const category of GATE_CATEGORIES) {
    const keys = CATEGORY_SOURCE_KEYS[category];
    categories[category] = {
      enabled: config[keys.gate] === true,
      scannerEnabled: config[keys.scanner] === true,
      mandatory: mandatory.has(category),
    };
  }

  const enforcementAt = config.gateEnforcementAt
    ? new Date(config.gateEnforcementAt).toISOString()
    : null;

  return {
    schemaVersion: 1,
    version:
      typeof config.policyVersion === "number" && config.policyVersion > 0
        ? config.policyVersion
        : 1,
    mode: config.gateMode === "ENFORCEMENT" ? "ENFORCEMENT" : "WARNING",
    enforcementAt,
    thresholds: {
      critical: config.securityGateCritical,
      high: config.securityGateHigh,
      medium: config.securityGateMedium,
      low: config.securityGateLow,
    },
    categories,
    requireExceptionApproval: config.requireExceptionApproval !== false,
  };
}

/** JSON stable : clés triées, utilisé pour l'empreinte de politique. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export function hashSecurityPolicy(policy: SecurityPolicyV1): string {
  return crypto
    .createHash("sha256")
    .update(stableJson(policy))
    .digest("hex");
}

/** Mode effectif à un instant donné (bascule programmée). */
export function effectiveGateMode(
  policy: Pick<SecurityPolicyV1, "mode" | "enforcementAt">,
  now: Date = new Date(),
): GateMode {
  if (!policy.enforcementAt) return policy.mode;
  return new Date(policy.enforcementAt).getTime() > now.getTime()
    ? "WARNING"
    : "ENFORCEMENT";
}
