// packages/scanners/src/scanners/semgrep.scanner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";

const execFileAsync = promisify(execFile);

interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: {
      category?: string;
      cwe?: string[] | string;
      owasp?: string[] | string;
      references?: string[];
      confidence?: string;
    };
  };
}

interface SemgrepOutput {
  results?: SemgrepResult[];
  errors?: unknown[];
}

export class SemgrepScanner implements SecurityScanner {
  public readonly name = "semgrep";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("semgrep", ["--version"], {
        timeout: 180_000, // Python à froid peut prendre 30-60s sur Windows
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
    logs.push(
      "[info] Semgrep : analyse du workspace (node_modules/vendor exclus)",
    );

    try {
      const { stdout, stderr } = await execFileAsync(
        "semgrep",
        [
          "--config=auto",
          "--json",
          "--quiet",
          "--timeout", "60",
          // Le workspace contient les dépendances installées par
          // INSTALL_DEPS : sans ces exclusions, Semgrep analyse des
          // milliers de fichiers de node_modules et échoue par timeout.
          "--exclude=**/node_modules/**",
          "--exclude=**/vendor/**",
          "--exclude=**/.git/**",
          "--exclude=**/dist/**",
          "--exclude=**/build/**",
          "--exclude=**/coverage/**",
          "--exclude=**/.next/**",
          ctx.workspaceDir,
        ],
        {
          timeout: 10 * 60_000,
          maxBuffer: 50 * 1024 * 1024,
          shell: true,
        },
      );

      if (stderr) logs.push(`[stderr] ${stderr.trim().slice(0, 2000)}`);

      let parsed: SemgrepOutput = {};
      try {
        parsed = JSON.parse(stdout) as SemgrepOutput;
      } catch {
        logs.push("[warn] Impossible de parser la sortie JSON de Semgrep");
      }

      const results = parsed.results ?? [];

      const normalized: NormalizedFinding[] = results.map((r) => ({
        tool: "semgrep",
        severity: this.mapSeverity(r.extra?.severity),
        filePath: r.start?.line ? `${r.path}:${r.start.line}` : r.path,
        description: r.extra?.message ?? r.check_id,
        reference: r.extra?.metadata?.references?.[0] ?? r.check_id,
        raw: {
          checkId: r.check_id,
          startLine: r.start?.line,
          endLine: r.end?.line,
          category: r.extra?.metadata?.category,
          cwe: r.extra?.metadata?.cwe,
          owasp: r.extra?.metadata?.owasp,
        },
      }));

      const severityCounts = this.countSeverities(normalized);
      logs.push(
        `[info] ${normalized.length} résultat(s) Semgrep : ` +
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
      const anyErr = err as { stdout?: string; code?: number };
      if (anyErr.stdout && anyErr.stdout.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(anyErr.stdout) as SemgrepOutput;
          const results = parsed.results ?? [];
          const normalized: NormalizedFinding[] = results.map((r) => ({
            tool: "semgrep",
            severity: this.mapSeverity(r.extra?.severity),
            filePath: r.start?.line ? `${r.path}:${r.start.line}` : r.path,
            description: r.extra?.message ?? r.check_id,
            reference: r.extra?.metadata?.references?.[0] ?? r.check_id,
          }));
          const severityCounts = this.countSeverities(normalized);
          logs.push(
            `[info] Semgrep code retour ${anyErr.code ?? "?"} — résultats parsés`,
          );
          return {
            scanner: this.name,
            status: "SUCCESS",
            durationMs: Date.now() - started,
            exitCode: anyErr.code ?? null,
            vulnerabilityCount: normalized.length,
            severityCounts,
            findings: normalized,
            logs,
          };
        } catch {
          // tombe dans le catch externe
        }
      }

      logs.push(`[error] Échec de Semgrep : ${msg}`);
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
    }
  }

  private mapSeverity(s: string | undefined): ScannerSeverity {
    switch ((s ?? "").toUpperCase()) {
      case "ERROR":
        return "HIGH";
      case "WARNING":
        return "MEDIUM";
      case "INFO":
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