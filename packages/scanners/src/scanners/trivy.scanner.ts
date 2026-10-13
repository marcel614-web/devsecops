// packages/scanners/src/scanners/trivy.scanner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";

const execFileAsync = promisify(execFile);

const TRIVY_BIN = process.env.TRIVY_BIN?.trim() || "trivy";
const TRIVY_CACHE_DIR =
  process.env.TRIVY_CACHE_DIR?.trim() || "D:\\ProjetL3\\Outils\\Trivy\\cache";

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
  SchemaVersion?: number;
  Results?: TrivyResult[];
}

export interface TrivyScanOptions extends ScanContext {
  imageTag: string;
}

export class TrivyScanner implements SecurityScanner {
  public readonly name = "trivy";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(TRIVY_BIN, ["--version"], {
        timeout: 30_000,
        shell: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async scanImage(opts: TrivyScanOptions): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];
    const reportPath = path.join(
      os.tmpdir(),
      `trivy-${crypto.randomUUID()}.json`,
    );

    try {
      await execFileAsync(
        TRIVY_BIN,
        [
          "image",
          "--cache-dir", TRIVY_CACHE_DIR,
          "--format", "json",
          "--output", reportPath,
          "--severity", "CRITICAL,HIGH,MEDIUM,LOW",
          "--skip-db-update",
          "--no-progress",
          "--quiet",
          opts.imageTag,
        ],
        {
          timeout: 15 * 60_000,
          maxBuffer: 100 * 1024 * 1024,
          shell: true,
        },
      );

      let parsed: TrivyOutput = {};
      try {
        const content = await fs.readFile(reportPath, "utf8");
        if (content.trim().length > 0) {
          parsed = JSON.parse(content) as TrivyOutput;
        }
      } catch {
        logs.push("[warn] Impossible de lire le rapport Trivy JSON");
      }

      const findings: NormalizedFinding[] = [];
      for (const r of parsed.Results ?? []) {
        for (const v of r.Vulnerabilities ?? []) {
          findings.push({
            tool: "trivy",
            severity: this.mapSeverity(v.Severity),
            packageName: v.PkgName,
            version: v.InstalledVersion,
            fixedVersion: v.FixedVersion,
            description: v.Title ?? v.Description ?? v.VulnerabilityID ?? "CVE",
            reference: v.PrimaryURL ?? v.VulnerabilityID,
            raw: {
              target: r.Target,
              targetClass: r.Class,
              targetType: r.Type,
              cve: v.VulnerabilityID,
            },
          });
        }
      }

      const severityCounts = this.countSeverities(findings);
      logs.push(
        `[info] Trivy : ${findings.length} vulnérabilité(s) — ` +
          `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
          `medium=${severityCounts.medium}, low=${severityCounts.low}`,
      );

      return {
        scanner: this.name,
        status: "SUCCESS",
        durationMs: Date.now() - started,
        exitCode: 0,
        vulnerabilityCount: findings.length,
        severityCounts,
        findings,
        logs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`[error] Échec de Trivy : ${msg}`);
      return {
        scanner: this.name,
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs,
        error: msg,
      };
    } finally {
      await fs.rm(reportPath, { force: true }).catch(() => undefined);
    }
  }

  async scan(_ctx: ScanContext): Promise<ScanResult> {
    throw new Error(
      "TrivyScanner.scan() n'est pas supporté — utilisez scanImage({ imageTag })",
    );
  }

  private mapSeverity(s: string | undefined): ScannerSeverity {
    switch ((s ?? "").toUpperCase()) {
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

  private countSeverities(findings: NormalizedFinding[]) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) {
      if (f.severity === "CRITICAL") counts.critical++;
      else if (f.severity === "HIGH") counts.high++;
      else if (f.severity === "MEDIUM") counts.medium++;
      else if (f.severity === "LOW") counts.low++;
      else counts.info++;
    }
    return counts;
  }
}