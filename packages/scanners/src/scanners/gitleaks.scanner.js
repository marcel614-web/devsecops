"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitleaksScanner = void 0;
// packages/scanners/src/scanners/gitleaks.scanner.ts
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const GITLEAKS_BIN = process.env.GITLEAKS_BIN?.trim() || "gitleaks";
class GitleaksScanner {
    name = "gitleaks";
    async isAvailable() {
        try {
            await execFileAsync(GITLEAKS_BIN, ["version"], {
                timeout: 15_000,
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
        const reportPath = node_path_1.default.join(node_os_1.default.tmpdir(), `gitleaks-${node_crypto_1.default.randomUUID()}.json`);
        try {
            const { stdout, stderr } = await execFileAsync(GITLEAKS_BIN, [
                "dir",
                ctx.workspaceDir,
                "--report-format", "json",
                "--report-path", reportPath,
                "--no-banner",
                "--exit-code", "0",
            ], {
                timeout: 5 * 60_000,
                maxBuffer: 20 * 1024 * 1024,
                shell: true,
            });
            if (stdout)
                logs.push(`[stdout] ${stdout.trim()}`);
            if (stderr)
                logs.push(`[stderr] ${stderr.trim()}`);
            let findings = [];
            try {
                const content = await promises_1.default.readFile(reportPath, "utf8");
                if (content.trim().length > 0) {
                    findings = JSON.parse(content);
                }
            }
            catch {
                logs.push("[info] Aucun fichier de rapport Gitleaks produit");
            }
            const normalized = findings.map((f) => ({
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
            logs.push(`[info] ${normalized.length} secret(s) détecté(s) : ` +
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
        }
        finally {
            await promises_1.default.rm(reportPath, { force: true }).catch(() => undefined);
        }
    }
    mapSeverity(f) {
        const rule = (f.RuleID ?? "").toLowerCase();
        const desc = (f.Description ?? "").toLowerCase();
        const text = `${rule} ${desc}`;
        if (text.includes("private-key") ||
            text.includes("private_key") ||
            text.includes("aws") ||
            text.includes("gcp") ||
            text.includes("azure") ||
            text.includes("github-pat") ||
            text.includes("github_oauth") ||
            text.includes("slack") ||
            text.includes("stripe")) {
            return "CRITICAL";
        }
        if (text.includes("token") ||
            text.includes("api-key") ||
            text.includes("apikey") ||
            text.includes("secret")) {
            return "HIGH";
        }
        if ((f.Entropy ?? 0) > 4.5) {
            return "MEDIUM";
        }
        return "LOW";
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
exports.GitleaksScanner = GitleaksScanner;
//# sourceMappingURL=gitleaks.scanner.js.map