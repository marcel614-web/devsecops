// packages/scanners/src/scanners/zap.scanner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ScanContext,
  ScanResult,
  SecurityScanner,
  NormalizedFinding,
  ScannerSeverity,
} from "../scanner";

const execFileAsync = promisify(execFile);

const ZAP_IMAGE =
  process.env.ZAP_IMAGE ?? "ghcr.io/zaproxy/zaproxy:stable";
const ZAP_BASELINE_BIN =
  process.env.ZAP_BASELINE_BIN ?? "zap-baseline.py";

// ============================================================
// TYPES DU RAPPORT ZAP
// ============================================================

export interface ZapInstance {
  uri?: string;
  method?: string;
  param?: string;
  evidence?: string;
}

export interface ZapAlert {
  pluginid?: string;
  alert?: string;
  name?: string;
  riskcode?: string;
  confidence?: string;
  riskdesc?: string;
  desc?: string;
  solution?: string;
  reference?: string;
  cweid?: string;
  wascid?: string;
  instances?: ZapInstance[];
}

export interface ZapReport {
  "@version"?: string;
  site?: Array<{
    "@name"?: string;
    "@host"?: string;
    "@port"?: string;
    "@ssl"?: string;
    alerts?: ZapAlert[];
  }>;
}

// ============================================================
// PARSING
// ============================================================

function mapRiskCode(code: string | undefined): ScannerSeverity {
  switch ((code ?? "").trim()) {
    case "3":
      return "HIGH";
    case "2":
      return "MEDIUM";
    case "1":
      return "LOW";
    default:
      return "INFO";
  }
}

function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Transforme un rapport JSON ZAP en ScanResult normalisé.
 * Exporté séparément pour être réutilisé par le worker (scan via SSH).
 */
export function parseZapReport(
  report: ZapReport,
  targetUrl: string,
  durationMs = 0,
  exitCode: number | null = 0,
): ScanResult {
  const findings: NormalizedFinding[] = [];

  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      const instances = alert.instances?.length ? alert.instances : [{}];
      const title = alert.alert ?? alert.name ?? "Alerte ZAP";
      for (const instance of instances) {
        findings.push({
          tool: "zap",
          technology: "WEB",
          severity: mapRiskCode(alert.riskcode),
          filePath: instance.uri ?? site["@name"] ?? targetUrl,
          description: stripHtml(alert.desc) ?? title,
          reference:
            alert.reference?.trim() ||
            (alert.cweid ? `CWE-${alert.cweid}` : undefined) ||
            (alert.pluginid ? `ZAP-${alert.pluginid}` : undefined),
          raw: {
            alert: title,
            pluginId: alert.pluginid,
            riskCode: alert.riskcode,
            riskDesc: alert.riskdesc,
            confidence: alert.confidence,
            cweId: alert.cweid,
            wascId: alert.wascid,
            solution: stripHtml(alert.solution),
            method: instance.method,
            param: instance.param,
            evidence: instance.evidence,
          },
        });
      }
    }
  }

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL") severityCounts.critical++;
    else if (f.severity === "HIGH") severityCounts.high++;
    else if (f.severity === "MEDIUM") severityCounts.medium++;
    else if (f.severity === "LOW") severityCounts.low++;
    else severityCounts.info++;
  }

  return {
    scanner: "zap",
    status: "SUCCESS",
    durationMs,
    exitCode,
    vulnerabilityCount: findings.length,
    severityCounts,
    findings,
    logs: [
      `[info] ZAP : ${findings.length} alerte(s) — ` +
        `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
        `medium=${severityCounts.medium}, low=${severityCounts.low}`,
    ],
  };
}

// ============================================================
// SCANNER LOCAL (Docker ou zap-baseline.py)
// ============================================================

/**
 * Scanner DAST ZAP.
 *
 * Le worker exécute ZAP sur la VM de déploiement via SSH (voir
 * `apps/worker/src/steps/dynamic-scan/zap.step.ts`) et réutilise
 * `parseZapReport`. Cette classe permet aussi une exécution locale
 * lorsque Docker ou zap-baseline.py est disponible sur la machine.
 */
export class ZapScanner implements SecurityScanner {
  public readonly name = "zap";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("docker", ["--version"], {
        timeout: 30_000,
        shell: true,
      });
      return true;
    } catch {
      try {
        await execFileAsync(ZAP_BASELINE_BIN, ["-h"], {
          timeout: 30_000,
          shell: true,
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async scan(ctx: ScanContext): Promise<ScanResult> {
    const started = Date.now();
    if (!ctx.targetUrl) {
      return {
        scanner: this.name,
        status: "FAILED",
        durationMs: 0,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs: ["[error] URL cible manquante pour ZAP"],
        error: "targetUrl requis pour un scan DAST",
      };
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zap-"));
    const reportPath = path.join(workDir, "report.json");

    try {
      let command = ZAP_BASELINE_BIN;
      let args = [
        "-t",
        ctx.targetUrl,
        "-J",
        reportPath,
        "-I",
      ];
      let shell = true;

      if (!(await this.hasBaselineBinary())) {
        command = "docker";
        args = [
          "run",
          "--rm",
          "-v",
          `${workDir}:/zap/wrk:rw`,
          ZAP_IMAGE,
          "zap-baseline.py",
          "-t",
          ctx.targetUrl,
          "-J",
          "/zap/wrk/report.json",
          "-I",
        ];
        shell = false;
      }

      let exitCode = 0;
      try {
        const result = await execFileAsync(command, args, {
          timeout: 15 * 60_000,
          maxBuffer: 50 * 1024 * 1024,
          shell,
        });
        exitCode = 0;
        if (result.stdout) {
          ctx.onLog?.("debug", result.stdout.slice(0, 2000)).catch(() => undefined);
        }
      } catch (err) {
        const anyErr = err as { code?: number; stdout?: string; stderr?: string };
        exitCode = anyErr.code ?? 1;
        // ZAP baseline : 1 = alertes, 2 = erreur technique.
        if (exitCode === 2) {
          throw new Error(
            `ZAP a échoué (code 2) : ${(anyErr.stderr ?? "").slice(0, 1000)}`,
          );
        }
      }

      const content = await fs.readFile(reportPath, "utf8");
      const report = JSON.parse(content) as ZapReport;
      return parseZapReport(report, ctx.targetUrl, Date.now() - started, exitCode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        scanner: this.name,
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs: [`[error] ZAP : ${msg}`],
        error: msg,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async hasBaselineBinary(): Promise<boolean> {
    try {
      await execFileAsync(ZAP_BASELINE_BIN, ["-h"], {
        timeout: 15_000,
        shell: true,
      });
      return true;
    } catch {
      return false;
    }
  }
}
