// packages/scanners/src/scanners/pip-audit.scanner.ts
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
import {
  FALLBACK_SEVERITY,
  fetchOsvSeverities,
} from "../severity/osv";


// Binaire configurable. Si pip-audit n'est pas dans le PATH, on tente
// `python -m pip_audit` (voir isAvailable / scan).
const PIP_AUDIT_BIN = process.env.PIP_AUDIT_BIN ?? "pip-audit";
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python";

interface PipAuditVuln {
  id?: string;
  fix_versions?: string[];
  description?: string;
  aliases?: string[];
}

interface PipAuditDependency {
  name?: string;
  version?: string;
  vulns?: PipAuditVuln[];
  skip_reason?: string | null;
}

type PipAuditOutput =
  | { dependencies?: PipAuditDependency[] }
  | PipAuditDependency[];

/**
 * Scanner SCA pour les projets Python.
 * S'appuie sur `pip-audit --format=json`.
 */
export class PipAuditScanner implements SecurityScanner {
  public readonly name = "pip-audit";

  async isAvailable(workspaceDir?: string): Promise<boolean> {
    if (workspaceDir) {
      const venvPipAudit = this.venvPath(
        workspaceDir,
        process.platform === "win32" ? "pip-audit.exe" : "pip-audit",
      );
      if (await this.exists(venvPipAudit)) return true;
    }

    try {
      await execTool(PIP_AUDIT_BIN, ["--version"], {
        timeout: 30_000,
      });
      return true;
    } catch {
      try {
        await execTool(PYTHON_BIN, ["-m", "pip_audit", "--version"], {
          timeout: 30_000,
        });
        return true;
      } catch {
        if (workspaceDir) {
          const venvPython = this.venvPath(
            workspaceDir,
            process.platform === "win32" ? "python.exe" : "python",
          );
          if (await this.exists(venvPython)) {
            try {
              await execTool(
                venvPython,
                ["-m", "pip_audit", "--version"],
                { timeout: 30_000 },
              );
              return true;
            } catch {
              return false;
            }
          }
        }
        return false;
      }
    }
  }

  private venvPath(workspaceDir: string, bin: string): string {
    return path.join(
      workspaceDir,
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      bin,
    );
  }

  async scan(ctx: ScanContext): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];

    // PrÃƒÂ©fÃƒÂ¨re pip-audit installÃƒÂ© dans le venv crÃƒÂ©ÃƒÂ© par INSTALL_DEPS.
    const venvPipAudit = this.venvPath(
      ctx.workspaceDir,
      process.platform === "win32" ? "pip-audit.exe" : "pip-audit",
    );
    const primaryBin = (await this.exists(venvPipAudit))
      ? venvPipAudit
      : PIP_AUDIT_BIN;

    const venvPython = this.venvPath(
      ctx.workspaceDir,
      process.platform === "win32" ? "python.exe" : "python",
    );
    const fallbackPython = (await this.exists(venvPython))
      ? venvPython
      : PYTHON_BIN;

    // DÃƒÂ©termine la cible du scan : requirements.txt, venv local, ou projet.
    const hasRequirements = await this.exists(
      path.join(ctx.workspaceDir, "requirements.txt"),
    );
    const hasVenv = await this.exists(path.join(ctx.workspaceDir, ".venv"));
    const hasPyproject = await this.exists(
      path.join(ctx.workspaceDir, "pyproject.toml"),
    );

    if (!hasRequirements && !hasVenv && !hasPyproject) {
      logs.push("[info] Aucun fichier de dÃƒÂ©pendances Python Ã¢â‚¬â€ SCA Python ignorÃƒÂ©");
      return this.emptyResult(started, logs, "SUCCESS");
    }

    const auditTargetArgs = hasRequirements
      ? ["-r", "requirements.txt"]
      : hasVenv
        ? ["--path", ".venv"]
        : ["."];

    let stdout = "";
    let exitCode = 0;
    try {
      const result = await execTool(
        primaryBin,
        [...auditTargetArgs, "--format=json", "--progress-spinner=off"],
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

      if (!stdout.trim()) {
        // DeuxiÃƒÂ¨me tentative avec `python -m pip_audit`.
        try {
          const fallback = await execTool(
            fallbackPython,
            [
              "-m",
              "pip_audit",
              ...auditTargetArgs,
              "--format=json",
              "--progress-spinner=off",
            ],
            {
              cwd: ctx.workspaceDir,
              timeout: 5 * 60_000,
              maxBuffer: 30 * 1024 * 1024,
            },
          );
          stdout = fallback.stdout;
          exitCode = 0;
        } catch (fallbackErr) {
          const fb = fallbackErr as {
            stdout?: string;
            stderr?: string;
            code?: number;
            message?: string;
          };
          stdout = fb.stdout ?? "";
          if (!stdout.trim()) {
            const msg =
              fb.stderr?.trim() ||
              anyErr.stderr?.trim() ||
              anyErr.message ||
              "pip-audit a ÃƒÂ©chouÃƒÂ©";
            logs.push(`[error] ${msg.slice(0, 2000)}`);
            return {
              scanner: this.name,
              status: "FAILED",
              durationMs: Date.now() - started,
              exitCode: fb.code ?? exitCode ?? 2,
              vulnerabilityCount: 0,
              severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
              findings: [],
              logs,
              error: msg,
            };
          }
        }
      }
      if (exitCode !== 1 && exitCode !== 0) {
        logs.push(`[warn] pip-audit a retournÃƒÂ© le code ${exitCode}`);
      }
    }

    let parsed: PipAuditOutput;
    try {
      parsed = JSON.parse(stdout) as PipAuditOutput;
    } catch {
      // PROBLÃƒË†ME CORRIGÃƒâ€° : une sortie illisible ÃƒÂ©tait rapportÃƒÂ©e comme
      // "SUCCESS" avec 0 vulnÃƒÂ©rabilitÃƒÂ©. Un scan cassÃƒÂ© devenait donc un
      // scan propre, et le Security Gate validait le pipeline.
      // On remonte dÃƒÂ©sormais un ÃƒÂ©chec technique.
      logs.push("[error] Impossible de parser la sortie JSON de pip-audit");
      return {
        scanner: this.name,
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: exitCode ?? 2,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs,
        error: "Sortie de pip-audit illisible (JSON invalide)",
      };
    }

    const dependencies = Array.isArray(parsed)
      ? parsed
      : (parsed.dependencies ?? []);

    // RÃƒÂ©solution des sÃƒÂ©vÃƒÂ©ritÃƒÂ©s rÃƒÂ©elles via OSV (une seule requÃƒÂªte batch).
    const allVulns = dependencies.flatMap((dep) => dep.vulns ?? []);
    const severities = await this.resolveSeverities(allVulns, logs);

    const findings: NormalizedFinding[] = [];
    for (const dep of dependencies) {
      for (const vuln of dep.vulns ?? []) {
        const id = vuln.id ?? vuln.aliases?.[0] ?? "CVE inconnue";
        findings.push({
          tool: this.name,
          technology: "PYTHON",
          severity: this.resolveSeverity(vuln, severities),
          packageName: dep.name,
          version: dep.version,
          fixedVersion: vuln.fix_versions?.join(", "),
          description:
            vuln.description?.slice(0, 2000) ??
            `VulnÃƒÂ©rabilitÃƒÂ© ${id} dans ${dep.name ?? "un paquet Python"}`,
          reference: id,
          raw: {
            aliases: vuln.aliases,
            fixVersions: vuln.fix_versions,
          },
        });
      }
    }

    const severityCounts = this.countSeverities(findings);
    logs.push(
      `[info] ${findings.length} vulnÃƒÂ©rabilitÃƒÂ©(s) pip-audit : ` +
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

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private emptyResult(
    started: number,
    logs: string[],
    status: "SUCCESS" | "FAILED",
  ): ScanResult {    return {
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

  private mapSeverity(_vuln: PipAuditVuln): ScannerSeverity {
    // pip-audit ne fournit pas de score CVSS dans sa sortie JSON.
    // La sÃƒÂ©vÃƒÂ©ritÃƒÂ© rÃƒÂ©elle est rÃƒÂ©solue via l'API OSV (voir `resolveSeverities`).
    // Cette valeur n'est qu'un filet de sÃƒÂ©curitÃƒÂ© : elle ne doit pas ÃƒÂªtre
    // utilisÃƒÂ©e seule, sinon un CVE critique Python ne dÃƒÂ©clencherait jamais
    // le Security Gate.
    return FALLBACK_SEVERITY;
  }

  /**
   * RÃƒÂ©sout la sÃƒÂ©vÃƒÂ©ritÃƒÂ© rÃƒÂ©elle des vulnÃƒÂ©rabilitÃƒÂ©s via l'API OSV.
   *
   * Retourne une Map identifiant (CVE / GHSA / PYSEC) Ã¢â€ â€™ sÃƒÂ©vÃƒÂ©ritÃƒÂ©.
   * En cas d'ÃƒÂ©chec rÃƒÂ©seau, on conserve la sÃƒÂ©vÃƒÂ©ritÃƒÂ© de repli (HIGH),
   * qui est volontairement conservatrice : mieux vaut surestimer.
   */
  private async resolveSeverities(
    vulns: PipAuditVuln[],
    logs: string[],
  ): Promise<Map<string, ScannerSeverity>> {
    const ids: string[] = [];
    for (const vuln of vulns) {
      const id = vuln.id ?? vuln.aliases?.[0];
      if (id) ids.push(id);
      for (const alias of vuln.aliases ?? []) ids.push(alias);
    }

    if (ids.length === 0) return new Map();

    try {
      const severities = await fetchOsvSeverities(ids);
      if (severities.size === 0) {
        logs.push(
          "[warn] OSV n'a retournÃƒÂ© aucune sÃƒÂ©vÃƒÂ©ritÃƒÂ© Ã¢â‚¬â€ classification par dÃƒÂ©faut (HIGH)",
        );
      }
      return severities;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(
        `[warn] RÃƒÂ©solution de sÃƒÂ©vÃƒÂ©ritÃƒÂ© OSV impossible (${msg}) Ã¢â‚¬â€ classification par dÃƒÂ©faut (HIGH)`,
      );
      return new Map();
    }
  }

  /**
   * DÃƒÂ©termine la sÃƒÂ©vÃƒÂ©ritÃƒÂ© finale d'une vulnÃƒÂ©rabilitÃƒÂ© pip-audit.
   */
  private resolveSeverity(
    vuln: PipAuditVuln,
    severities: Map<string, ScannerSeverity>,
  ): ScannerSeverity {
    const candidates = [vuln.id, ...(vuln.aliases ?? [])].filter(
      (v): v is string => Boolean(v),
    );

    for (const candidate of candidates) {
      const found = severities.get(candidate);
      if (found) return found;
    }

    return this.mapSeverity(vuln);
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
