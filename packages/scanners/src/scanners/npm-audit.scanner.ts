// packages/scanners/src/scanners/npm-audit.scanner.ts
import { execTool } from "@devsecops/shared";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";


interface NpmAuditAdvisory {
  source?: number;
  name?: string;
  dependency?: string;
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
  fixAvailable?:
    | boolean
    | { name?: string; version?: string; isSemVerMajor?: boolean };
}

interface NpmAuditVulnerability {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  range?: string;
  fixAvailable?:
    | boolean
    | { name?: string; version?: string; isSemVerMajor?: boolean };
  via?: Array<NpmAuditAdvisory | string>;
}

interface NpmAuditOutput {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
  metadata?: {
    vulnerabilities?: {
      info?: number;
      low?: number;
      moderate?: number;
      high?: number;
      critical?: number;
      total?: number;
    };
  };
}

export class NpmAuditScanner implements SecurityScanner {
  public readonly name = "npm-audit";

  async isAvailable(): Promise<boolean> {
    try {
      await execTool("npm", ["--version"], { timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  }

  async scan(ctx: ScanContext): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];

    try {
      // npm audit retourne code 1 dÃƒÂ¨s qu'il trouve des vulnÃƒÂ©rabilitÃƒÂ©s.
      // On capture stdout/stderr dans le catch aussi.
      let stdout = "";
      try {
        const result = await execTool(
          "npm",
          ["audit", "--json", "--audit-level=none"],
          {
            cwd: ctx.workspaceDir,
            timeout: 3 * 60_000,
            maxBuffer: 30 * 1024 * 1024,
          },
        );
        stdout = result.stdout;
      } catch (err) {
        const anyErr = err as { stdout?: string };
        stdout = anyErr.stdout ?? "";
        if (!stdout) throw err;
        logs.push("[info] npm audit a retournÃƒÂ© un code non nul (findings dÃƒÂ©tectÃƒÂ©s)");
      }

      let parsed: NpmAuditOutput = {};
      try {
        parsed = JSON.parse(stdout) as NpmAuditOutput;
      } catch {
        logs.push("[warn] Impossible de parser la sortie JSON de npm audit");
        return {
          scanner: this.name,
          status: "SUCCESS",
          durationMs: Date.now() - started,
          exitCode: 0,
          vulnerabilityCount: 0,
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [],
          logs,
        };
      }

      const vulns = parsed.vulnerabilities ?? {};
      const findings: NormalizedFinding[] = [];

      for (const [pkgName, vuln] of Object.entries(vulns)) {
        // npm audit regroupe souvent les avis. On prend le premier avis texte.
        const advisories = (vuln.via ?? []).filter(
          (v): v is NpmAuditAdvisory => typeof v === "object" && v !== null,
        );
        const advisory = advisories[0];

        const fixVersion =
          vuln.fixAvailable && typeof vuln.fixAvailable === "object"
            ? vuln.fixAvailable.version
            : undefined;

        findings.push({
          tool: this.name,
          severity: this.mapSeverity(vuln.severity ?? advisory?.severity),
          packageName: pkgName,
          version: vuln.range,
          fixedVersion: fixVersion,
          description: advisory?.title ?? `VulnÃƒÂ©rabilitÃƒÂ© dans ${pkgName}`,
          reference: advisory?.url,
          raw: {
            isDirect: vuln.isDirect,
            range: vuln.range,
            advisories: advisories.map((a) => a.source),
          },
        });
      }

      const severityCounts = this.countSeverities(findings);
      logs.push(
        `[info] ${findings.length} vulnÃƒÂ©rabilitÃƒÂ©(s) npm : ` +
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
      logs.push(`[error] Ãƒâ€°chec de npm audit : ${msg}`);
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
    switch ((s ?? "").toLowerCase()) {
      case "critical":
        return "CRITICAL";
      case "high":
        return "HIGH";
      case "moderate":
      case "medium":
        return "MEDIUM";
      case "low":
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