// packages/scanners/src/scanners/composer-audit.scanner.ts
import fs from "node:fs/promises";
import path from "node:path";
import { execTool } from "@devsecops/shared";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";


// Binaire configurable : utile si composer n'est pas dans le PATH.
const COMPOSER_BIN = process.env.COMPOSER_BIN ?? "composer";

interface ComposerAuditAdvisory {
  advisoryId?: string;
  packageName?: string;
  affectedVersions?: string;
  title?: string;
  cve?: string;
  link?: string;
  reportedAt?: string;
  severity?: string;
}

interface ComposerAuditOutput {
  advisories?: Record<string, ComposerAuditAdvisory[]>;
  abandoned?: Record<string, string>;
}

/**
 * Scanner SCA pour les projets PHP.
 * S'appuie sur `composer audit --format=json`.
 */
export class ComposerAuditScanner implements SecurityScanner {
  public readonly name = "composer-audit";

  async isAvailable(): Promise<boolean> {
    try {
      await execTool(COMPOSER_BIN, ["--version"], {
        timeout: 30_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async scan(ctx: ScanContext): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];

    // Sans lockfile, composer audit ne peut pas rÃƒÂ©soudre les versions.
    try {
      await fs.access(path.join(ctx.workspaceDir, "composer.lock"));
    } catch {
      logs.push("[info] composer.lock absent Ã¢â‚¬â€ SCA PHP ignorÃƒÂ©");
      return this.emptyResult(started, logs, "SUCCESS");
    }

    let stdout = "";
    let exitCode = 0;
    try {
      const result = await execTool(
        COMPOSER_BIN,
        ["audit", "--format=json", "--no-interaction", "--no-ansi"],
        {
          cwd: ctx.workspaceDir,
          timeout: 5 * 60_000,
          maxBuffer: 30 * 1024 * 1024,
        },
      );
      stdout = result.stdout;
    } catch (err) {
      const anyErr = err as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      stdout = anyErr.stdout ?? "";
      exitCode = anyErr.code ?? 1;

      // composer audit retourne 1 quand des vulnÃƒÂ©rabilitÃƒÂ©s existent.
      // Un code 2 (ou l'absence de JSON) indique une vraie erreur technique.
      if (!stdout.trim()) {
        const msg = anyErr.stderr?.trim() || anyErr.message || "composer audit a ÃƒÂ©chouÃƒÂ©";
        logs.push(`[error] ${msg.slice(0, 2000)}`);
        return {
          scanner: this.name,
          status: "FAILED",
          durationMs: Date.now() - started,
          exitCode: exitCode || 2,
          vulnerabilityCount: 0,
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [],
          logs,
          error: msg,
        };
      }
      if (exitCode !== 1) {
        logs.push(`[warn] composer audit a retournÃƒÂ© le code ${exitCode}`);
      }
    }

    let parsed: ComposerAuditOutput = {};
    try {
      parsed = JSON.parse(stdout) as ComposerAuditOutput;
    } catch {
      logs.push("[warn] Impossible de parser la sortie JSON de composer audit");
      return this.emptyResult(started, logs, "SUCCESS");
    }

    const findings: NormalizedFinding[] = [];
    for (const [pkgName, advisories] of Object.entries(parsed.advisories ?? {})) {
      for (const advisory of advisories ?? []) {
        findings.push({
          tool: this.name,
          technology: "PHP",
          severity: this.mapSeverity(advisory.severity),
          packageName: advisory.packageName ?? pkgName,
          version: advisory.affectedVersions,
          description:
            advisory.title ??
            `VulnÃƒÂ©rabilitÃƒÂ© ${advisory.cve ?? advisory.advisoryId ?? "inconnue"} dans ${pkgName}`,
          reference: advisory.link ?? advisory.cve ?? advisory.advisoryId,
          raw: {
            advisoryId: advisory.advisoryId,
            cve: advisory.cve,
            affectedVersions: advisory.affectedVersions,
            reportedAt: advisory.reportedAt,
          },
        });
      }
    }

    const severityCounts = this.countSeverities(findings);
    logs.push(
      `[info] ${findings.length} vulnÃƒÂ©rabilitÃƒÂ©(s) composer : ` +
        `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
        `medium=${severityCounts.medium}, low=${severityCounts.low}`,
    );

    return {
      scanner: this.name,
      status: "SUCCESS",
      durationMs: Date.now() - started,
      exitCode,
      vulnerabilityCount: findings.length,
      severityCounts,
      findings,
      logs,
    };
  }

  private emptyResult(
    started: number,
    logs: string[],
    status: "SUCCESS" | "FAILED",
  ): ScanResult {
    return {
      scanner: this.name,
      status,
      durationMs: Date.now() - started,
      exitCode: 0,
      vulnerabilityCount: 0,
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      logs,
    };
  }

  private mapSeverity(s: string | undefined): ScannerSeverity {
    switch ((s ?? "").toLowerCase()) {
      case "critical":
        return "CRITICAL";
      case "high":
        return "HIGH";
      case "medium":
      case "moderate":
        return "MEDIUM";
      case "low":
        return "LOW";
      default:
        return "MEDIUM";
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
