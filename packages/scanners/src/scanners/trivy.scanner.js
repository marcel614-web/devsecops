"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrivyScanner = void 0;
// packages/scanners/src/scanners/trivy.scanner.ts
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const TRIVY_BIN = process.env.TRIVY_BIN?.trim() || "trivy";
const TRIVY_CACHE_DIR = process.env.TRIVY_CACHE_DIR?.trim() || "D:\\ProjetL3\\Outils\\Trivy\\cache";
class TrivyScanner {
    name = "trivy";
    async isAvailable() {
        try {
            await execFileAsync(TRIVY_BIN, ["--version"], {
                timeout: 30_000,
                shell: true,
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async scanImage(opts) {
        const started = Date.now();
        const logs = [];
        const reportPath = node_path_1.default.join(node_os_1.default.tmpdir(), `trivy-${node_crypto_1.default.randomUUID()}.json`);
        try {
            await execFileAsync(TRIVY_BIN, [
                "image",
                "--cache-dir", TRIVY_CACHE_DIR,
                "--format", "json",
                "--output", reportPath,
                "--severity", "CRITICAL,HIGH,MEDIUM,LOW",
                "--skip-db-update",
                "--no-progress",
                "--quiet",
                opts.imageTag,
            ], {
                timeout: 15 * 60_000,
                maxBuffer: 100 * 1024 * 1024,
                shell: true,
            });
            let parsed = {};
            try {
                const content = await promises_1.default.readFile(reportPath, "utf8");
                if (content.trim().length > 0) {
                    parsed = JSON.parse(content);
                }
            }
            catch {
                logs.push("[warn] Impossible de lire le rapport Trivy JSON");
            }
            const findings = [];
            for (const r of parsed.Results ?? []) {
                for (const v of r.Vulnerabilities ?? []) {
                    findings.push({
                        tool: "trivy",
                        severity: this.mapSeverity(v.Severity),
                        packageName: v.PkgName,
                        version: v.InstalledVersion,
                        fixedVersion: v.FixedVersion,
                        description: v.Title ?? v.Description ?? v.VulnerabilityID ?? "CVE",
                        reference: v.PrimaryURL ?? v.VulnerabilityID,
                        raw: {
                            target: r.Target,
                            targetClass: r.Class,
                            targetType: r.Type,
                            cve: v.VulnerabilityID,
                        },
                    });
                }
            }
            const severityCounts = this.countSeverities(findings);
            logs.push(`[info] Trivy : ${findings.length} vulnérabilité(s) — ` +
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
            logs.push(`[error] Échec de Trivy : ${msg}`);
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
    async scan(_ctx) {
        throw new Error("TrivyScanner.scan() n'est pas supporté — utilisez scanImage({ imageTag })");
    }
    mapSeverity(s) {
        switch ((s ?? "").toUpperCase()) {
            case "CRITICAL":
                return "CRITICAL";
            case "HIGH":
                return "HIGH";
            case "MEDIUM":
                return "MEDIUM";
            case "LOW":
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
exports.TrivyScanner = TrivyScanner;
//# sourceMappingURL=trivy.scanner.js.map