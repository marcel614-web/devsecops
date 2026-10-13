// packages/scanners/src/scanners/gitleaks.scanner.ts
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

const GITLEAKS_BIN = process.env.GITLEAKS_BIN?.trim() || "gitleaks";

interface GitleaksFinding {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  Match?: string;
  Secret?: string;
  Entropy?: number;
}

export class GitleaksScanner implements SecurityScanner {
  public readonly name = "gitleaks";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(GITLEAKS_BIN, ["version"], {
        timeout: 15_000,
        shell: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async scan(ctx: ScanContext): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];

    const reportPath = path.join(
      os.tmpdir(),
      `gitleaks-${crypto.randomUUID()}.json`,
    );

    try {
      const { stdout, stderr } = await execFileAsync(
        GITLEAKS_BIN,
        [
          "dir",
          ctx.workspaceDir,
          "--report-format", "json",
          "--report-path", reportPath,
          "--no-banner",
          "--exit-code", "0",
        ],
        {
          timeout: 5 * 60_000,
          maxBuffer: 20 * 1024 * 1024,
          shell: true,
        },
      );

      if (stdout) logs.push(`[stdout] ${stdout.trim()}`);
      if (stderr) logs.push(`[stderr] ${stderr.trim()}`);

      let findings: GitleaksFinding[] = [];
      try {
        const content = await fs.readFile(reportPath, "utf8");
        if (content.trim().length > 0) {
          findings = JSON.parse(content) as GitleaksFinding[];
        }
      } catch {
        logs.push("[info] Aucun fichier de rapport Gitleaks produit");
      }

      const normalized: NormalizedFinding[] = findings.map((f) => ({
        tool: "gitleaks",
        severity: this.mapSeverity(f),
        filePath: f.File,
        description: f.Description ?? f.RuleID ?? "Secret détecté",
        reference: f.RuleID ? `gitleaks:${f.RuleID}` : undefined,
        raw: {
          ruleId: f.RuleID,
          startLine: f.StartLine,
          entropy: f.Entropy,
        },
      }));

      const severityCounts = this.countSeverities(normalized);
      logs.push(
        `[info] ${normalized.length} secret(s) détecté(s) : ` +
          `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
          `medium=${severityCounts.medium}, low=${severityCounts.low}`,
      );

      return {
        scanner: this.name,
        status: "SUCCESS",
        durationMs: Date.now() - started,
        exitCode: 0,
        vulnerabilityCount: normalized.length,
        severityCounts,
        findings: normalized,
        logs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`[error] Échec de Gitleaks : ${msg}`);
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

  private mapSeverity(f: GitleaksFinding): ScannerSeverity {
    const rule = (f.RuleID ?? "").toLowerCase();
    const desc = (f.Description ?? "").toLowerCase();
    const text = `${rule} ${desc}`;

    if (
      text.includes("private-key") ||
      text.includes("private_key") ||
      text.includes("aws") ||
      text.includes("gcp") ||
      text.includes("azure") ||
      text.includes("github-pat") ||
      text.includes("github_oauth") ||
      text.includes("slack") ||
      text.includes("stripe")
    ) {
      return "CRITICAL";
    }

    if (
      text.includes("token") ||
      text.includes("api-key") ||
      text.includes("apikey") ||
      text.includes("secret")
    ) {
      return "HIGH";
    }

    if ((f.Entropy ?? 0) > 4.5) {
      return "MEDIUM";
    }

    return "LOW";
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