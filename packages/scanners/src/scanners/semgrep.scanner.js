"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemgrepScanner = void 0;
// packages/scanners/src/scanners/semgrep.scanner.ts
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
class SemgrepScanner {
    name = "semgrep";
    async isAvailable() {
        try {
            await execFileAsync("semgrep", ["--version"], {
                timeout: 180_000, // Python à froid peut prendre 30-60s sur Windows
                shell: true,
            });
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
            const { stdout, stderr } = await execFileAsync("semgrep", [
                "--config=auto",
                "--json",
                "--quiet",
                "--no-git-ignore",
                "--timeout", "60",
                ctx.workspaceDir,
            ], {
                timeout: 10 * 60_000,
                maxBuffer: 50 * 1024 * 1024,
                shell: true,
            });
            if (stderr)
                logs.push(`[stderr] ${stderr.trim().slice(0, 2000)}`);
            let parsed = {};
            try {
                parsed = JSON.parse(stdout);
            }
            catch {
                logs.push("[warn] Impossible de parser la sortie JSON de Semgrep");
            }
            const results = parsed.results ?? [];
            const normalized = results.map((r) => ({
                tool: "semgrep",
                severity: this.mapSeverity(r.extra?.severity),
                filePath: r.path,
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
            logs.push(`[info] ${normalized.length} résultat(s) Semgrep : ` +
                `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
                `medium=${severityCounts.medium}, low=${severityCounts.low}`);
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const anyErr = err;
            if (anyErr.stdout && anyErr.stdout.trim().startsWith("{")) {
                try {
                    const parsed = JSON.parse(anyErr.stdout);
                    const results = parsed.results ?? [];
                    const normalized = results.map((r) => ({
                        tool: "semgrep",
                        severity: this.mapSeverity(r.extra?.severity),
                        filePath: r.path,
                        description: r.extra?.message ?? r.check_id,
                        reference: r.extra?.metadata?.references?.[0] ?? r.check_id,
                    }));
                    const severityCounts = this.countSeverities(normalized);
                    logs.push(`[info] Semgrep code retour ${anyErr.code ?? "?"} — résultats parsés`);
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
                }
                catch {
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
    mapSeverity(s) {
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
exports.SemgrepScanner = SemgrepScanner;
//# sourceMappingURL=semgrep.scanner.js.map