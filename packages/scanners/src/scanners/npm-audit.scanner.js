"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NpmAuditScanner = void 0;
// packages/scanners/src/scanners/npm-audit.scanner.ts
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
class NpmAuditScanner {
    name = "npm-audit";
    async isAvailable() {
        try {
            await execFileAsync("npm", ["--version"], { timeout: 30_000, shell: true });
            return true;
        }
        catch {
            return false;
        }
    }
    async scan(ctx) {
        const started = Date.now();
        const logs = [];
        try {
            // npm audit retourne code 1 dès qu'il trouve des vulnérabilités.
            // On capture stdout/stderr dans le catch aussi.
            let stdout = "";
            try {
                const result = await execFileAsync("npm", ["audit", "--json", "--audit-level=none"], {
                    cwd: ctx.workspaceDir,
                    timeout: 3 * 60_000,
                    maxBuffer: 30 * 1024 * 1024,
                    shell: true,
                });
                stdout = result.stdout;
            }
            catch (err) {
                const anyErr = err;
                stdout = anyErr.stdout ?? "";
                if (!stdout)
                    throw err;
                logs.push("[info] npm audit a retourné un code non nul (findings détectés)");
            }
            let parsed = {};
            try {
                parsed = JSON.parse(stdout);
            }
            catch {
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
            const findings = [];
            for (const [pkgName, vuln] of Object.entries(vulns)) {
                // npm audit regroupe souvent les avis. On prend le premier avis texte.
                const advisories = (vuln.via ?? []).filter((v) => typeof v === "object" && v !== null);
                const advisory = advisories[0];
                const fixVersion = vuln.fixAvailable && typeof vuln.fixAvailable === "object"
                    ? vuln.fixAvailable.version
                    : undefined;
                findings.push({
                    tool: this.name,
                    severity: this.mapSeverity(vuln.severity ?? advisory?.severity),
                    packageName: pkgName,
                    version: vuln.range,
                    fixedVersion: fixVersion,
                    description: advisory?.title ?? `Vulnérabilité dans ${pkgName}`,
                    reference: advisory?.url,
                    raw: {
                        isDirect: vuln.isDirect,
                        range: vuln.range,
                        advisories: advisories.map((a) => a.source),
                    },
                });
            }
            const severityCounts = this.countSeverities(findings);
            logs.push(`[info] ${findings.length} vulnérabilité(s) npm : ` +
                `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
                `medium=${severityCounts.medium}, low=${severityCounts.low}`);
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logs.push(`[error] Échec de npm audit : ${msg}`);
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
    mapSeverity(s) {
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
    countSeverities(findings) {
        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        for (const f of findings) {
            if (f.severity === "CRITICAL")
                counts.critical++;
            else if (f.severity === "HIGH")
                counts.high++;
            else if (f.severity === "MEDIUM")
                counts.medium++;
            else if (f.severity === "LOW")
                counts.low++;
            else
                counts.info++;
        }
        return counts;
    }
}
exports.NpmAuditScanner = NpmAuditScanner;
//# sourceMappingURL=npm-audit.scanner.js.map