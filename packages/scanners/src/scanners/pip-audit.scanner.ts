// packages/scanners/src/scanners/pip-audit.scanner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";

const execFileAsync = promisify(execFile);

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
      await execFileAsync(PIP_AUDIT_BIN, ["--version"], {
        timeout: 30_000,
        shell: true,
      });
      return true;
    } catch {
      try {
        await execFileAsync(PYTHON_BIN, ["-m", "pip_audit", "--version"], {
          timeout: 30_000,
          shell: true,
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
              await execFileAsync(
                venvPython,
                ["-m", "pip_audit", "--version"],
                { timeout: 30_000, shell: true },
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

    // Préfère pip-audit installé dans le venv créé par INSTALL_DEPS.
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

    // Détermine la cible du scan : requirements.txt, venv local, ou projet.
    const hasRequirements = await this.exists(
      path.join(ctx.workspaceDir, "requirements.txt"),
    );
    const hasVenv = await this.exists(path.join(ctx.workspaceDir, ".venv"));
    const hasPyproject = await this.exists(
      path.join(ctx.workspaceDir, "pyproject.toml"),
    );

    if (!hasRequirements && !hasVenv && !hasPyproject) {
      logs.push("[info] Aucun fichier de dépendances Python — SCA Python ignoré");
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
      const result = await execFileAsync(
        primaryBin,
        [...auditTargetArgs, "--format=json", "--progress-spinner=off"],
        {
          cwd: ctx.workspaceDir,
          timeout: 5 * 60_000,
          maxBuffer: 30 * 1024 * 1024,
          shell: true,
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
        // Deuxième tentative avec `python -m pip_audit`.
        try {
          const fallback = await execFileAsync(
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
              shell: true,
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
              "pip-audit a échoué";
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
        logs.push(`[warn] pip-audit a retourné le code ${exitCode}`);
      }
    }

    let parsed: PipAuditOutput;
    try {
      parsed = JSON.parse(stdout) as PipAuditOutput;
    } catch {
      logs.push("[warn] Impossible de parser la sortie JSON de pip-audit");
      return this.emptyResult(started, logs, "SUCCESS");
    }

    const dependencies = Array.isArray(parsed)
      ? parsed
      : (parsed.dependencies ?? []);

    const findings: NormalizedFinding[] = [];
    for (const dep of dependencies) {
      for (const vuln of dep.vulns ?? []) {
        const id = vuln.id ?? vuln.aliases?.[0] ?? "CVE inconnue";
        findings.push({
          tool: this.name,
          technology: "PYTHON",
          severity: this.mapSeverity(vuln),
          packageName: dep.name,
          version: dep.version,
          fixedVersion: vuln.fix_versions?.join(", "),
          description:
            vuln.description?.slice(0, 2000) ??
            `Vulnérabilité ${id} dans ${dep.name ?? "un paquet Python"}`,
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
      `[info] ${findings.length} vulnérabilité(s) pip-audit : ` +
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
    // On classe en MEDIUM par défaut ; les CVE restent consultables via la référence.
    return "MEDIUM";
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
