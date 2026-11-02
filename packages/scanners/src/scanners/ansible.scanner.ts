// packages/scanners/src/scanners/ansible.scanner.ts
/**
 * Contrôles statiques Ansible.
 *
 * - `ansible-lint --offline` : analyse les règles, sans accès Galaxy.
 * - `ansible-playbook --syntax-check` : validation syntaxique uniquement.
 *
 * Aucun playbook n'est exécuté (`--syntax-check` s'arrête avant les tâches).
 * Aucune inventaire de production n'est utilisé : `localhost,` est fourni
 * uniquement pour satisfaire l'analyseur.
 */
import path from "node:path";
import { execTool } from "@devsecops/shared";
import type {
  NormalizedFinding,
  ScanContext,
  ScanResult,
  ScannerSeverity,
  SecurityScanner,
} from "../scanner";

const ANSIBLE_LINT_BIN = process.env.ANSIBLE_LINT_BIN?.trim() || "ansible-lint";
const ANSIBLE_PLAYBOOK_BIN =
  process.env.ANSIBLE_PLAYBOOK_BIN?.trim() || "ansible-playbook";
const LINT_TIMEOUT_MS =
  Number.parseInt(process.env.ANSIBLE_LINT_TIMEOUT_MS ?? "", 10) || 5 * 60_000;
const SYNTAX_TIMEOUT_MS =
  Number.parseInt(process.env.ANSIBLE_SYNTAX_TIMEOUT_MS ?? "", 10) ||
  2 * 60_000;

const versionCache = new Map<string, string>();

function firstLine(value: string): string {
  return value.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}

interface LenientExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * `execTool` rejette les codes non nuls. ansible-lint retourne 2 lorsqu'il
 * trouve des violations : la sortie JSON est alors parfaitement valide.
 * On récupère donc stdout/stderr/code sans confondre « findings » et
 * « outil indisponible ».
 */
async function runLenient(
  bin: string,
  args: string[],
  options: Parameters<typeof execTool>[2],
): Promise<LenientExecResult> {
  try {
    const result = await execTool(bin, args, options);
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (err) {
    const candidate = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string | null;
    };
    if (typeof candidate.stdout !== "undefined" || typeof candidate.stderr !== "undefined") {
      return {
        stdout: String(candidate.stdout ?? ""),
        stderr: String(candidate.stderr ?? ""),
        code: typeof candidate.code === "number" ? candidate.code : 1,
      };
    }
    throw err;
  }
}

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function countSeverities(findings: NormalizedFinding[]) {
  const counts = emptyCounts();
  for (const finding of findings) {
    if (finding.severity === "CRITICAL") counts.critical++;
    else if (finding.severity === "HIGH") counts.high++;
    else if (finding.severity === "MEDIUM") counts.medium++;
    else if (finding.severity === "LOW") counts.low++;
    else counts.info++;
  }
  return counts;
}

export function mapAnsibleSeverity(value: unknown): ScannerSeverity {
  const severity = String(value ?? "").trim().toLowerCase();
  if (severity === "very_high" || severity === "critical") return "CRITICAL";
  if (severity === "high" || severity === "major" || severity === "error") {
    return "HIGH";
  }
  if (severity === "medium" || severity === "minor" || severity === "warning") {
    return "MEDIUM";
  }
  if (severity === "low" || severity === "very_low") return "LOW";
  return "INFO";
}

interface RawAnsibleLintIssue {
  check_name?: string;
  checkName?: string;
  description?: string;
  message?: string;
  filename?: string;
  path?: string;
  lineno?: number;
  line?: number;
  column?: number;
  severity?: string;
  url?: string;
  tags?: string[];
  categories?: string[];
}

function extractIssues(parsed: unknown): RawAnsibleLintIssue[] {
  if (Array.isArray(parsed)) return parsed as RawAnsibleLintIssue[];
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { results?: unknown[] }).results)
  ) {
    return (parsed as { results: RawAnsibleLintIssue[] }).results;
  }
  return [];
}

/**
 * Normalise la sortie JSON d'ansible-lint. Le format a changé entre les
 * versions : on accepte une liste directe et l'enveloppe `{ results: [] }`.
 */
export function parseAnsibleLintOutput(output: string): NormalizedFinding[] {
  const text = stripAnsi(output).trim();
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  return extractIssues(parsed).map((issue) => {
    const line = issue.lineno ?? issue.line;
    const filename = issue.filename ?? issue.path ?? "playbook";
    const rule = issue.check_name ?? issue.checkName ?? "ansible-lint";
    return {
      tool: "ansible-lint",
      technology: "IAC",
      severity: mapAnsibleSeverity(issue.severity),
      filePath: line ? `${filename}:${line}` : filename,
      description:
        issue.message ??
        issue.description ??
        `Règle Ansible non respectée : ${rule}`,
      reference: issue.url ?? rule,
      raw: {
        checkName: rule,
        message: issue.message,
        description: issue.description,
        filename,
        lineno: line,
        column: issue.column,
        severity: issue.severity,
        tags: issue.tags ?? issue.categories,
      },
    };
  });
}

function relativePlaybook(workspaceDir: string, playbook: string): string {
  const relative = path.relative(workspaceDir, playbook) || path.basename(playbook);
  return relative.split(path.sep).join("/");
}

export class AnsibleLintScanner implements SecurityScanner {
  public readonly name = "ansible-lint";
  private version: string | null = null;
  private binary = ANSIBLE_LINT_BIN;

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execTool(this.binary, ["--version"], {
        timeout: 30_000,
      });
      this.version =
        versionCache.get(this.binary) ??
        firstLine(stripAnsi(`${result.stdout}\n${result.stderr}`)) ??
        null;
      if (this.version) versionCache.set(this.binary, this.version);
      return true;
    } catch {
      this.version = null;
      return false;
    }
  }

  getVersion(): string | null {
    return this.version;
  }

  async scan(
    ctx: ScanContext & {
      playbooks?: string[];
      timeoutMs?: number;
      maxPlaybooks?: number;
    },
  ): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];
    const maxPlaybooks = Math.max(1, ctx.maxPlaybooks ?? 20);
    const playbooks = (ctx.playbooks ?? []).slice(0, maxPlaybooks);
    const args = ["--offline", "--nocolor", "--format", "json"];

    if (playbooks.length > 0) {
      args.push(...playbooks.map((p) => relativePlaybook(ctx.workspaceDir, p)));
    } else {
      args.push(".");
    }

    try {
      const result = await runLenient(this.binary, args, {
        cwd: ctx.workspaceDir,
        timeout: ctx.timeoutMs ?? LINT_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, ANSIBLE_NOCOLOR: "1" },
      });

      const findings = parseAnsibleLintOutput(result.stdout);
      logs.push(
        `[info] ansible-lint : ${findings.length} résultat(s) (code ${result.code})`,
      );

      // ansible-lint retourne 2 lorsqu'il trouve des violations. Un code
      // non nul SANS résultat JSON exploitable est une indisponibilité ou
      // une erreur d'exécution, jamais un succès à zéro finding.
      if (findings.length === 0 && result.code !== 0) {
        const detail = firstLine(
          stripAnsi(result.stderr || result.stdout) || "sortie illisible",
        );
        return {
          scanner: this.name,
          status: "FAILED",
          durationMs: Date.now() - started,
          exitCode: result.code,
          scannerVersion: this.version ?? undefined,
          vulnerabilityCount: 0,
          severityCounts: emptyCounts(),
          findings: [],
          logs,
          error: `ansible-lint a échoué (code ${result.code}) : ${detail}`,
        };
      }

      return {
        scanner: this.name,
        status: "SUCCESS",
        durationMs: Date.now() - started,
        exitCode: result.code,
        scannerVersion: this.version ?? undefined,
        vulnerabilityCount: findings.length,
        severityCounts: countSeverities(findings),
        findings,
        logs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`[error] ansible-lint : ${message}`);
      return {
        scanner: this.name,
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        scannerVersion: this.version ?? undefined,
        vulnerabilityCount: 0,
        severityCounts: emptyCounts(),
        findings: [],
        logs,
        error: message,
      };
    }
  }
}

export interface AnsibleSyntaxFailure {
  playbook: string;
  message: string;
}

/**
 * Extrait les échecs de syntax-check. Une erreur de syntaxe est un finding
 * HIGH : c'est un défaut réel du playbook, pas un simple warning d'outil.
 */
export function normalizeAnsibleSyntaxFailures(
  failures: AnsibleSyntaxFailure[],
): NormalizedFinding[] {
  return failures.map((failure) => ({
    tool: "ansible-syntax-check",
    technology: "IAC",
    severity: "HIGH",
    filePath: failure.playbook,
    description: failure.message.slice(0, 1000),
    reference: "ansible-playbook:syntax-check",
    raw: { playbook: failure.playbook, message: failure.message },
  }));
}

export class AnsibleSyntaxScanner implements SecurityScanner {
  public readonly name = "ansible-syntax-check";
  private version: string | null = null;
  private binary = ANSIBLE_PLAYBOOK_BIN;

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execTool(this.binary, ["--version"], {
        timeout: 30_000,
      });
      this.version =
        versionCache.get(this.binary) ??
        firstLine(stripAnsi(`${result.stdout}\n${result.stderr}`)) ??
        null;
      if (this.version) versionCache.set(this.binary, this.version);
      return true;
    } catch {
      this.version = null;
      return false;
    }
  }

  getVersion(): string | null {
    return this.version;
  }

  async scan(
    ctx: ScanContext & {
      playbooks?: string[];
      timeoutMs?: number;
      maxPlaybooks?: number;
    },
  ): Promise<ScanResult> {
    const started = Date.now();
    const logs: string[] = [];
    const maxPlaybooks = Math.max(1, ctx.maxPlaybooks ?? 20);
    const playbooks = (ctx.playbooks ?? []).slice(0, maxPlaybooks);

    if (playbooks.length === 0) {
      return {
        scanner: this.name,
        status: "SUCCESS",
        outcome: "NOT_APPLICABLE",
        durationMs: Date.now() - started,
        exitCode: 0,
        scannerVersion: this.version ?? undefined,
        vulnerabilityCount: 0,
        severityCounts: emptyCounts(),
        findings: [],
        logs: ["[info] Aucun playbook Ansible détecté"],
      };
    }

    const failures: AnsibleSyntaxFailure[] = [];

    try {
      for (const playbook of playbooks) {
        const relative = relativePlaybook(ctx.workspaceDir, playbook);
        const result = await runLenient(
          this.binary,
          [
            "--syntax-check",
            "-i",
            "localhost,",
            "--playbook-dir",
            ctx.workspaceDir,
            relative,
          ],
          {
            cwd: ctx.workspaceDir,
            timeout: ctx.timeoutMs ?? SYNTAX_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, ANSIBLE_NOCOLOR: "1" },
          },
        );

        if (result.code !== 0) {
          const detail =
            firstLine(stripAnsi(result.stderr || result.stdout)) ||
            "syntax-check en échec";
          failures.push({ playbook: relative, message: detail });
          logs.push(`[error] ${relative} : ${detail}`);
        } else {
          logs.push(`[info] ${relative} : syntaxe valide`);
        }
      }

      const findings = normalizeAnsibleSyntaxFailures(failures);
      return {
        scanner: this.name,
        status: "SUCCESS",
        durationMs: Date.now() - started,
        exitCode: failures.length > 0 ? 1 : 0,
        scannerVersion: this.version ?? undefined,
        vulnerabilityCount: findings.length,
        severityCounts: countSeverities(findings),
        findings,
        logs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`[error] ansible-playbook : ${message}`);
      return {
        scanner: this.name,
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        scannerVersion: this.version ?? undefined,
        vulnerabilityCount: 0,
        severityCounts: emptyCounts(),
        findings: [],
        logs,
        error: message,
      };
    }
  }
}
