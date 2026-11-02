// packages/scanners/src/scanners/semgrep.scanner.ts
import { execTool } from "@devsecops/shared";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";


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
    const bin = process.env.SEMGREP_BIN ?? "semgrep";
    try {
      await execTool(bin, ["--version"], {
        timeout: 180_000, // Python ÃƒÂ  froid peut prendre 30-60s sur Windows
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
      const bin = process.env.SEMGREP_BIN ?? "semgrep";
      const { stdout, stderr } = await execTool(
        bin,
        [
          "--config=auto",
          "--json",
          "--quiet",
          "--timeout", "60",
          // Le workspace contient les dÃƒÂ©pendances installÃƒÂ©es par
          // INSTALL_DEPS : sans ces exclusions, Semgrep analyse des
          // milliers de fichiers de node_modules et ÃƒÂ©choue par timeout.
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
        },
      );

      if (stderr) logs.push(`[stderr] ${stderr.trim().slice(0, 2000)}`);

      let parsed: SemgrepOutput;
      try {
        parsed = JSON.parse(stdout) as SemgrepOutput;
      } catch (parseErr) {
        const message =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        logs.push(`[error] Impossible de parser la sortie JSON de Semgrep : ${message}`);
        return {
          scanner: this.name,
          status: "FAILED",
          outcome: "PARSE_ERROR",
          durationMs: Date.now() - started,
          exitCode: 0,
          vulnerabilityCount: 0,
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [],
          logs,
          error: `Impossible de parser la sortie Semgrep : ${message}`,
        };
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
        `[info] ${normalized.length} rÃƒÂ©sultat(s) Semgrep : ` +
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
            `[info] Semgrep code retour ${anyErr.code ?? "?"} Ã¢â‚¬â€ rÃƒÂ©sultats parsÃƒÂ©s`,
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

      logs.push(`[error] Ãƒâ€°chec de Semgrep : ${msg}`);
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