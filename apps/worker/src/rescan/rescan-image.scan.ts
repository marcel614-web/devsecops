// apps/worker/src/rescan/rescan-image.scan.ts
import { shellQuote } from "@devsecops/shared";
import type {
  NormalizedFinding,
  ScanResult,
  ScannerSeverity,
} from "@devsecops/scanners";
import type { SshRunner } from "../runners/ssh.runner";

const TRIVY_VOLUME = process.env.TRIVY_VM_CACHE_VOLUME?.trim() || "trivy-cache";
const TRIVY_IMAGE =
  process.env.TRIVY_VM_IMAGE?.trim() || "aquasec/trivy:0.58.0";
const TRIVY_CACHE_MOUNT =
  process.env.TRIVY_VM_CACHE_MOUNT?.trim() || "/root/.cache/trivy";
const TRIVY_DB_DIR =
  process.env.TRIVY_VM_DB_DIR?.trim() || `${TRIVY_CACHE_MOUNT}/db`;
const SCAN_TIMEOUT_MS =
  Number.parseInt(process.env.RESCAN_TRIVY_TIMEOUT_MS ?? "", 10) || 15 * 60_000;

interface TrivyVulnerability {
  VulnerabilityID?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Severity?: string;
  Title?: string;
  Description?: string;
  PrimaryURL?: string;
}

interface TrivyResult {
  Target?: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[];
}

interface TrivyOutput {
  Results?: TrivyResult[];
}

export function mapTrivySeverity(value: string | undefined): ScannerSeverity {
  switch ((value ?? "").toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "INFO";
  }
}

export function parseTrivyImageOutput(output: string): NormalizedFinding[] {
  let parsed: TrivyOutput;
  try {
    parsed = JSON.parse(output) as TrivyOutput;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Impossible de parser le JSON Trivy : ${message}`);
  }

  const findings: NormalizedFinding[] = [];
  for (const result of parsed.Results ?? []) {
    for (const vulnerability of result.Vulnerabilities ?? []) {
      findings.push({
        tool: "trivy",
        severity: mapTrivySeverity(vulnerability.Severity),
        packageName: vulnerability.PkgName,
        version: vulnerability.InstalledVersion,
        fixedVersion: vulnerability.FixedVersion,
        description:
          vulnerability.Title ??
          vulnerability.Description ??
          vulnerability.VulnerabilityID ??
          "CVE",
        reference: vulnerability.PrimaryURL ?? vulnerability.VulnerabilityID,
        raw: {
          target: result.Target,
          targetClass: result.Class,
          targetType: result.Type,
          cve: vulnerability.VulnerabilityID,
          source: "rescan-by-digest",
        },
      });
    }
  }
  return findings;
}

function countSeverities(findings: NormalizedFinding[]) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity === "CRITICAL") counts.critical++;
    else if (finding.severity === "HIGH") counts.high++;
    else if (finding.severity === "MEDIUM") counts.medium++;
    else if (finding.severity === "LOW") counts.low++;
    else counts.info++;
  }
  return counts;
}

function validateDigest(digest: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      `Digest d'image invalide (${digest}) : rescan refusé, artefact non identifiable`,
    );
  }
}

async function resolveTrivyVersion(ssh: SshRunner): Promise<string> {
  try {
    const result = await ssh.exec(
      `docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' ${shellQuote(TRIVY_IMAGE)} 2>/dev/null`,
      20_000,
    );
    const label = result.stdout.trim();
    if (label && label !== "<no value>") {
      return `${TRIVY_IMAGE} (${label})`;
    }
  } catch {
    // Le label est optionnel : l'image reste la référence traçable.
  }
  return TRIVY_IMAGE;
}

/**
 * Réévalue exactement l'artefact déployé, sans reconstruction.
 *
 * Le digest est vérifié sur la VM. Un tag temporaire pointe vers ce digest
 * pour que Trivy analyse l'image locale exacte, puis il est retiré. Le nom
 * d'origine n'est jamais utilisé comme preuve d'identité.
 */
export async function scanDeployedImageByDigest(params: {
  ssh: SshRunner;
  imageDigest: string;
  imageTag: string | null;
  rescanRunId: string;
  timeoutMs: number;
  onLog?: (level: "info" | "warn" | "error" | "debug", message: string) => Promise<void>;
}): Promise<ScanResult> {
  const started = Date.now();
  const logs: string[] = [];
  const { ssh, imageDigest, imageTag, rescanRunId } = params;
  validateDigest(imageDigest);

  const log = async (
    level: "info" | "warn" | "error" | "debug",
    message: string,
  ): Promise<void> => {
    logs.push(`[${level}] ${message}`);
    await params.onLog?.(level, message);
  };

  const safeId = rescanRunId.replace(/[^a-zA-Z0-9_.-]/gu, "").slice(0, 40);
  const tempTag = `devsecops-rescan:${safeId}`;
  let tagged = false;

  try {
    const inspect = await ssh.exec(
      `docker image inspect --format '{{.Id}}' ${shellQuote(imageDigest)} 2>/dev/null`,
      30_000,
    );
    const observed = inspect.stdout.trim();
    if (inspect.code !== 0 || observed !== imageDigest) {
      throw new Error(
        `Artefact ${imageDigest} introuvable ou différent sur la VM ` +
          `(observé : ${observed || "absent"}). Le rescan ne peut pas réévaluer une image supprimée.`,
      );
    }

    // Tag temporaire vers l'ID local exact : Trivy ne peut pas analyser un
    // autre contenu, même si le tag d'origine a été réaffecté.
    const tagResult = await ssh.exec(
      `docker tag ${shellQuote(imageDigest)} ${shellQuote(tempTag)}`,
      30_000,
    );
    if (tagResult.code !== 0) {
      throw new Error(
        `Impossible de référencer temporairement l'artefact : ${tagResult.stderr.slice(0, 300)}`,
      );
    }
    tagged = true;
    await log(
      "info",
      `Artefact vérifié sur la VM : ${imageDigest} (tag d'origine ${imageTag ?? "inconnu"})`,
    );

    const trivyCheck = await ssh.exec(
      `docker image inspect ${shellQuote(TRIVY_IMAGE)} >/dev/null 2>&1 && echo OK || echo MISSING`,
      20_000,
    );
    if (trivyCheck.stdout.includes("MISSING")) {
      await log("info", `Téléchargement de l'image Trivy ${TRIVY_IMAGE}...`);
      const pullCode = await ssh.execStream(
        `docker pull ${shellQuote(TRIVY_IMAGE)}`,
        (chunk, stream) => {
          const line = chunk.trim();
          if (line && stream === "stderr") {
            void log("debug", `[pull] ${line}`);
          }
        },
        10 * 60_000,
      );
      if (pullCode !== 0) {
        throw new Error(
          "Impossible de télécharger l'image Trivy sur la VM (réseau ou registre indisponible)",
        );
      }
    }

    const dbCheck = await ssh.exec(
      `docker run --rm --network none -v ${shellQuote(`${TRIVY_VOLUME}:${TRIVY_CACHE_MOUNT}`)} ` +
        `--entrypoint sh ${shellQuote(TRIVY_IMAGE)} ` +
        `-c ${shellQuote(`test -s ${TRIVY_DB_DIR}/trivy.db && test -s ${TRIVY_DB_DIR}/metadata.json && echo CACHE_OK || echo CACHE_MISSING`)}`,
      2 * 60_000,
    );
    if (!dbCheck.stdout.includes("CACHE_OK")) {
      throw new Error(
        `Base de vulnérabilités Trivy absente sur la VM (volume ${TRIVY_VOLUME}). ` +
          "Le rescan ne peut pas prétendre utiliser des données actualisées sans base locale.",
      );
    }

    const version = await resolveTrivyVersion(ssh);

    const scanCmd = [
      "docker run --rm --network none",
      "-v /var/run/docker.sock:/var/run/docker.sock",
      `-v ${shellQuote(`${TRIVY_VOLUME}:${TRIVY_CACHE_MOUNT}`)}`,
      shellQuote(TRIVY_IMAGE),
      "image",
      "--skip-db-update",
      "--skip-java-db-update",
      "--skip-version-check",
      "--format json",
      "--quiet",
      "--no-progress",
      "--severity CRITICAL,HIGH,MEDIUM,LOW",
      shellQuote(tempTag),
    ].join(" ");

    await log("info", `Scan Trivy de l'artefact ${imageDigest}...`);
    const scan = await ssh.exec(
      scanCmd,
      Math.min(params.timeoutMs, SCAN_TIMEOUT_MS),
    );
    if (scan.code !== 0) {
      throw new Error(
        `Trivy a échoué (code ${scan.code}) : ${scan.stderr.slice(0, 500)}`,
      );
    }

    const findings = parseTrivyImageOutput(scan.stdout);
    const counts = countSeverities(findings);
    await log(
      "info",
      `Trivy : ${findings.length} vulnérabilité(s) — ` +
        `critical=${counts.critical}, high=${counts.high}, ` +
        `medium=${counts.medium}, low=${counts.low}`,
    );

    return {
      scanner: "trivy",
      status: "SUCCESS",
      durationMs: Date.now() - started,
      exitCode: 0,
      scannerVersion: version,
      vulnerabilityCount: findings.length,
      severityCounts: counts,
      findings,
      logs,
    };
  } finally {
    if (tagged) {
      await ssh
        .exec(`docker image rm ${shellQuote(tempTag)} >/dev/null 2>&1 || true`, 20_000)
        .catch(() => undefined);
    }
  }
}
