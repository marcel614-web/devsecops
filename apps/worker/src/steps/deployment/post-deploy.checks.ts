// apps/worker/src/steps/deployment/post-deploy.checks.ts
import { isHealthyHttpCode } from "./deploy.helper";

export type DeploymentCheckStatus = "PASSED" | "FAILED" | "SKIPPED";

export interface DeploymentCheck {
  key: string;
  label: string;
  status: DeploymentCheckStatus;
  required: boolean;
  detail: string;
  expected?: string;
  observed?: string;
}

export interface VerificationEvaluation {
  status: "PASSED" | "FAILED" | "SKIPPED";
  checks: DeploymentCheck[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    required: number;
  };
}

export function evaluateDeploymentChecks(
  checks: DeploymentCheck[],
): VerificationEvaluation {
  const required = checks.filter((check) => check.required);
  const passed = checks.filter((check) => check.status === "PASSED").length;
  const failed = checks.filter((check) => check.status === "FAILED").length;
  const skipped = checks.filter((check) => check.status === "SKIPPED").length;

  const status =
    required.length === 0
      ? "SKIPPED"
      : required.some((check) => check.status === "FAILED")
        ? "FAILED"
        : required.some((check) => check.status === "SKIPPED")
          ? "FAILED"
          : "PASSED";

  return {
    status,
    checks,
    summary: { passed, failed, skipped, required: required.length },
  };
}

/**
 * Le chemin de healthcheck est une donnée de configuration : il ne doit
 * jamais transformer l'URL en destination arbitraire (SSRF) ni injecter une
 * commande dans la ligne `curl` exécutée par SSH.
 */
export function validateHealthcheckPath(value: string | null | undefined): string {
  const candidate = (value ?? "/").trim() || "/";
  if (
    candidate.length > 512 ||
    !candidate.startsWith("/") ||
    candidate.includes("://") ||
    candidate.includes("\\") ||
    /[\r\n\u0000-\u001f]/u.test(candidate) ||
    candidate.split("/").includes("..")
  ) {
    throw new Error(
      "Chemin de healthcheck invalide : un chemin local commençant par / est requis",
    );
  }
  return candidate;
}

/**
 * Analyse `docker port <container> 80/tcp`. Toutes les liaisons observées
 * doivent pointer vers le port autorisé par la configuration.
 */
export function parsePublishedPorts(output: string): number[] {
  const ports = new Set<number>();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.trim().match(/:(\d{1,5})$/u);
    if (!match) continue;
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

export function publishedPortsMatch(
  output: string,
  expectedPort: number,
): { ok: boolean; ports: number[] } {
  const ports = parsePublishedPorts(output);
  return {
    ok: ports.length > 0 && ports.every((port) => port === expectedPort),
    ports,
  };
}

export function httpCheckPassed(code: string): boolean {
  return isHealthyHttpCode(code);
}

export function imageDigestMatches(
  observed: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const expectedDigest = (expected ?? "").trim();
  return (
    /^sha256:[a-f0-9]{64}$/u.test(expectedDigest) &&
    (observed ?? "").trim() === expectedDigest
  );
}
