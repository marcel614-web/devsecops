// packages/scanners/src/scanners/syft.scanner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { ScanContext, ScanResult } from "../scanner";

const execFileAsync = promisify(execFile);

const SYFT_IMAGE = process.env.SYFT_IMAGE ?? "anchore/syft:latest";

// ============================================================
// TYPES SYFT
// ============================================================

export interface SyftArtifact {
  id?: string;
  name?: string;
  version?: string;
  type?: string;
  language?: string;
  purl?: string;
  foundBy?: string;
  licenses?: Array<string | { value?: string; spdxExpression?: string }>;
  locations?: Array<{ path?: string }>;
}

export interface SyftReport {
  artifacts?: SyftArtifact[];
  source?: {
    type?: string;
    target?: { userInput?: string; imageID?: string; tags?: string[] };
  };
  descriptor?: { name?: string; version?: string };
  schema?: { version?: string };
}

export interface SyftSummary {
  packageCount: number;
  packages: Array<{
    name: string;
    version: string | null;
    type: string | null;
    language: string | null;
    purl: string | null;
    license: string | null;
  }>;
  source: SyftReport["source"] | null;
  descriptor: SyftReport["descriptor"] | null;
}

/**
 * Transforme un rapport Syft JSON en résumé compact stockable en base.
 * Le JSON brut peut être très volumineux : on ne conserve que l'essentiel.
 */
export function parseSyftReport(report: SyftReport): SyftSummary {
  const artifacts = report.artifacts ?? [];

  const packages = artifacts.slice(0, 10_000).map((a) => {
    const license = (a.licenses ?? [])
      .map((l) => (typeof l === "string" ? l : l.spdxExpression ?? l.value))
      .filter(Boolean)
      .join(", ");

    return {
      name: a.name ?? "inconnu",
      version: a.version ?? null,
      type: a.type ?? null,
      language: a.language ?? null,
      purl: a.purl ?? null,
      license: license || null,
    };
  });

  return {
    packageCount: artifacts.length,
    packages,
    source: report.source ?? null,
    descriptor: report.descriptor ?? null,
  };
}

// ============================================================
// SCANNER LOCAL (Docker)
// ============================================================

/**
 * Scanner SBOM Syft.
 *
 * Le worker exécute Syft sur la VM de déploiement via SSH et réutilise
 * `parseSyftReport`. Cette classe permet une exécution locale lorsque
 * Docker est disponible.
 */
export class SyftScanner {
  public readonly name = "syft";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("docker", ["--version"], {
        timeout: 30_000,
        shell: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async scanImage(imageTag: string): Promise<ScanResult & { summary?: SyftSummary }> {
    const started = Date.now();
    try {
      const { stdout } = await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          "/var/run/docker.sock:/var/run/docker.sock",
          SYFT_IMAGE,
          imageTag,
          "-o",
          "json",
          "--quiet",
        ],
        {
          timeout: 15 * 60_000,
          maxBuffer: 200 * 1024 * 1024,
          shell: false,
        },
      );

      const report = JSON.parse(stdout) as SyftReport;
      const summary = parseSyftReport(report);

      return {
        scanner: "syft",
        status: "SUCCESS",
        durationMs: Date.now() - started,
        exitCode: 0,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs: [`[info] Syft : ${summary.packageCount} paquet(s)`],
        summary,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        scanner: "syft",
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs: [`[error] Syft : ${msg}`],
        error: msg,
      };
    }
  }

  async scan(_ctx: ScanContext): Promise<ScanResult> {
    return {
      scanner: "syft",
      status: "FAILED",
      durationMs: 0,
      exitCode: null,
      vulnerabilityCount: 0,
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      logs: ["[error] SyftScanner.scan() nécessite une image — utilisez scanImage()"],
      error: "imageTag requis",
    };
  }
}
