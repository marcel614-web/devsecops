// apps/worker/src/steps/dynamic-scan/zap.step.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScanType } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import { persistScanResult } from "../../orchestrator/scanner.helper";
import { parseZapReport, type ZapReport } from "@devsecops/scanners";
import { shellQuote as sharedShellQuote, quoteForCmd } from "@devsecops/shared";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import { buildSandboxEnv } from "../../utils/sandbox-env";

const ZAP_IMAGE = process.env.ZAP_IMAGE ?? "ghcr.io/zaproxy/zaproxy:stable";
const ZAP_TIMEOUT_MS = 20 * 60_000;
const ZAP_LOCAL_TIMEOUT_MS = envNumber("ZAP_LOCAL_TIMEOUT_MS", 20 * 60_000);
const ZAP_PULL_TIMEOUT_MS = envNumber("ZAP_PULL_TIMEOUT_MS", 30 * 60_000);

// Espace minimal pour extraire l'image ZAP (~2,4 Go compressÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s, ~5 Go sur disque).
const ZAP_MIN_FREE_KB = 6 * 1024 * 1024;

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Quoting for commands executed ON THE VM (remote POSIX shell).
 * Delegated to the safe version of `@devsecops/shared` (single quotes).
 */
function shellQuote(value: string): string {
  return sharedShellQuote(value);
}

/**
 * Cherche une installation ZAP locale.
 *
 * PrioritÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â  `ZAP_BIN` (chemin exact), puis ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â  `ZAP_HOME` (rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pertoire
 * contenant `zap.bat` sous Windows ou `zap.sh` sous Linux/macOS).
 */
function resolveLocalZapBin(): string | null {
  const explicit = process.env.ZAP_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;

  const home = process.env.ZAP_HOME?.trim();
  if (!home) return null;

  const candidates =
    process.platform === "win32" ? ["zap.bat", "zap.exe"] : ["zap.sh", "zap"];
  for (const candidate of candidates) {
    const bin = path.join(home, candidate);
    if (existsSync(bin)) return bin;
  }
  return null;
}

function resolveLocalZapCwd(bin: string): string {
  const home = process.env.ZAP_HOME?.trim();
  if (home && existsSync(home)) return home;
  return path.dirname(bin);
}

interface LocalProcessResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

/**
 * Lance ZAP localement et tue l'arbre de processus en cas de timeout
 * (sous Windows, `zap.bat` lance `java.exe` dans un processus enfant).
 */
function runLocalZapProcess(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<LocalProcessResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const childEnv = buildSandboxEnv(process.env);

    // PROBLEME CORRIGE : sous Windows, la commande etait construite puis
    // lancee avec `shell: true`. L'URL cible (derivee de l'hote du serveur
    // de deploiement, saisi par l'utilisateur) etait donc interpretee comme
    // une ligne de commande.
    // On passe desormais par cmd.exe explicitement, avec un echappement
    // strict et "fail closed" des arguments.
    const command = isWindows
      ? [bin, ...args].map(quoteForCmd).join(" ")
      : bin;

    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", command], {
          cwd,
          shell: false,
          windowsVerbatimArguments: true,
          windowsHide: true,
          env: childEnv,
        })
      : spawn(bin, args, { cwd, shell: false, windowsHide: true, env: childEnv });

    let output = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      if (isWindows) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
        });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output, timedOut });
    });
  });
}

/**
 * Plan d'automatisation ZAP ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©quivalent au baseline scan Docker :
 * spider traditionnel + attente de la fin du scan passif + rapport JSON.
 * On n'active pas le scan actif pour ne pas modifier le comportement
 * historique de l'ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tape DAST.
 */
function buildZapAutomationPlan(targetUrl: string, reportDir: string): string {
  const reportDirYaml = JSON.stringify(reportDir.replace(/\\/g, "/"));
  return [
    "env:",
    "  contexts:",
    "    - name: baseline",
    "      urls:",
    `        - ${JSON.stringify(targetUrl)}`,
    "  parameters:",
    "    progressToStdout: true",
    "jobs:",
    "  - type: spider",
    "    parameters:",
    "      context: baseline",
    "      maxDuration: 2",
    "  - type: passiveScan-wait",
    "    parameters:",
    "      maxDuration: 10",
    "  - type: report",
    "    parameters:",
    "      template: traditional-json",
    `      reportDir: ${reportDirYaml}`,
    "      reportFile: report.json",
    "",
  ].join("\n");
}

async function logLocalZapOutput(
  ctx: StepContext,
  output: string,
): Promise<void> {
  let logged = 0;
  for (const raw of output.replace(/\r/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Ignore les barres de progression de -quickprogress.
    if (line.startsWith("[") && line.includes("%")) continue;
    await ctx.log("info", `[zap] ${line.slice(0, 500)}`);
    logged++;
    if (logged >= 200) {
      await ctx.log("debug", "[zap] sortie tronquÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â  200 lignes");
      break;
    }
  }
}

/**
 * Scan DAST OWASP ZAP.
 *
 * ZAP s'exÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cute dans un conteneur Docker sur la VM de dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ploiement,
 * contre l'URL de l'application dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ployÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©e par ce pipeline. Le rapport
 * JSON est rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cupÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© puis normalisÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© par `parseZapReport`.
 */
export async function zapStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  // 1. RÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cupÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¨re le dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ploiement de ce pipeline.
  const deployment = await prisma.deployment.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { id: true, status: true, url: true, imageTag: true },
  });

  if (!deployment || !deployment.url) {
    await ctx.log(
      "warn",
      "Aucun dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ploiement rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ussi pour ce pipeline ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â scan ZAP ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, technical: true, reason: "no deployment" },
    };
  }

  // 2. ExÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cution locale si ZAP est installÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© sur la machine du worker.
  //    Cela ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©vite de tÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©charger l'image Docker (~2,4 Go compressÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s)
  //    sur une VM de dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ploiement ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â  l'espace disque limitÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©.
  const localZapBin = resolveLocalZapBin();
  if (localZapBin) {
    return runLocalZapScan(ctx, deployment.url, localZapBin);
  }
  if (process.env.ZAP_BIN?.trim() || process.env.ZAP_HOME?.trim()) {
    await ctx.log(
      "warn",
      "ZAP local configurÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© (ZAP_BIN/ZAP_HOME) mais binaire introuvable ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â repli sur Docker/VM",
    );
  }

  // 3. Charge le projet et le serveur de dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ploiement.
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });
  if (!project?.server) {
    await ctx.log("warn", "Aucun serveur associÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â scan ZAP ignorÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, technical: true, reason: "no server" },
    };
  }
  const server = project.server;

  if (!server.encryptedPrivateKey) {
    return {
      success: false,
      exitCode: 1,
      error: "ClÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© SSH du serveur manquante",
    };
  }

  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chiffrer la clÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© SSH",
    };
  }
  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const targetUrl = deployment.url;
  const remoteDir = `/home/${server.username}/zap/${ctx.pipelineId}`;
  const reportPath = `${remoteDir}/report.json`;
  const ssh = new SshRunner();
  const started = Date.now();

  try {
    await ctx.log("info", `Connexion SSH pour ZAP (cible : ${targetUrl})...`);
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });

    // 3. VÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©rifie / tÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©charge l'image ZAP.
    const imageCheck = await ssh.exec(
      `docker image inspect ${shellQuote(ZAP_IMAGE)} >/dev/null 2>&1 && echo OK || echo MISSING`,
      20_000,
    );
    if (imageCheck.stdout.includes("MISSING")) {
      const disk = await ssh
        .exec("df -Pk / | awk 'NR==2 {print $4}'", 15_000)
        .catch(() => null);
      const freeKb = Number(disk?.stdout.trim());
      if (Number.isFinite(freeKb) && freeKb > 0 && freeKb < ZAP_MIN_FREE_KB) {
        throw new Error(
          `Espace disque insuffisant sur la VM pour l'image ZAP ` +
            `(${(freeKb / 1024 / 1024).toFixed(2)} Go libres, ~6 Go requis). ` +
            `Configurez ZAP_BIN/ZAP_HOME pour exÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cuter ZAP localement, ` +
            `ou agrandissez le disque de la VM.`,
        );
      }

      await ctx.log("info", "TÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chargement de l'image OWASP ZAP...");
      const pullCode = await ssh.execStream(
        `docker pull ${shellQuote(ZAP_IMAGE)}`,
        (chunk, stream) => {
          const line = chunk.trim();
          if (line && stream === "stderr") {
            void ctx.log("debug", `[zap pull] ${line}`);
          }
        },
        ZAP_PULL_TIMEOUT_MS,
      );
      if (pullCode !== 0) {
        throw new Error(
          "Impossible de tÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©charger l'image OWASP ZAP (timeout ou espace disque insuffisant)",
        );
      }
    }

    // 4. Lance le baseline scan.
    await ctx.log("info", "ExÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cution du scan OWASP ZAP (baseline)...");
    const command = [
      `mkdir -p ${shellQuote(remoteDir)}`,
      "&&",
      "docker run --rm",
      `-v ${shellQuote(`${remoteDir}:/zap/wrk:rw`)}`,
      shellQuote(ZAP_IMAGE),
      "zap-baseline.py",
      "-t",
      shellQuote(targetUrl),
      "-J",
      "/zap/wrk/report.json",
      "-r",
      "/zap/wrk/report.html",
      "-I",
    ].join(" ");

    const exitCode = await ssh.execStream(
      command,
      (chunk, stream) => {
        const line = chunk.trim();
        if (!line) return;
        for (const l of line.split("\n")) {
          if (!l.trim()) continue;
          void ctx.log(
            stream === "stderr" ? "debug" : "info",
            `[zap] ${l.trim()}`,
          );
        }
      },
      ZAP_TIMEOUT_MS,
    );

    // ZAP baseline : 0 = OK, 1 = alertes, 2 = erreur technique.
    if (exitCode === 2) {
      throw new Error("ZAP a signalÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© une erreur technique (code 2)");
    }
    if (exitCode === 1) {
      await ctx.log("info", "ZAP a dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tectÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© des alertes (code 1) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â analyse du rapport");
    }

    // 5. RÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cupÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¨re et parse le rapport JSON.
    const reportRead = await ssh.exec(`cat ${shellQuote(reportPath)}`, 60_000);
    if (reportRead.code !== 0 || !reportRead.stdout.trim()) {
      throw new Error(
        `Rapport ZAP introuvable ou vide : ${reportRead.stderr.slice(0, 300)}`,
      );
    }

    let report: ZapReport;
    try {
      report = JSON.parse(reportRead.stdout) as ZapReport;
    } catch {
      throw new Error("Impossible de parser le rapport JSON ZAP");
    }

    const result = parseZapReport(
      report,
      targetUrl,
      Date.now() - started,
      exitCode,
    );

    await persistScanResult(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.DAST,
      },
      result,
    );

    for (const line of result.logs) {
      await ctx.log("info", line);
    }

    return {
      success: true,
      exitCode: 0,
      data: {
        scanner: "zap",
        targetUrl,
        vulnerabilityCount: result.vulnerabilityCount,
        severityCounts: result.severityCounts,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°chec de ZAP : ${msg}`);

    // Persiste un scan FAILED pour que le Security Gate dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©tecte
    // l'ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chec technique au lieu de considÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©rer 0 vulnÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©rabilitÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©.
    await persistScanResult(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.DAST,
      },
      {
        scanner: "zap",
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs: [],
        error: msg,
      },
    );

    return { success: false, exitCode: 1, error: msg };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}

/**
 * ExÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cute ZAP directement sur la machine du worker.
 *
 * Le binaire est lancÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© avec un plan d'automatisation (spider + scan
 * passif + rapport JSON) dans un rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pertoire temporaire. Aucun accÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¨s SSH
 * ni tÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©chargement d'image Docker n'est nÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cessaire.
 */
async function runLocalZapScan(
  ctx: StepContext,
  targetUrl: string,
  zapBin: string,
): Promise<StepResult> {
  const started = Date.now();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "devsecops-zap-"));
  const reportPath = path.join(workDir, "report.json");
  const planPath = path.join(workDir, "plan.yaml");
  const zapHome = path.join(workDir, "zap-home");
  const cwd = resolveLocalZapCwd(zapBin);

  try {
    await ctx.log(
      "info",
      `ExÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©cution de ZAP local (${zapBin}) contre ${targetUrl}...`,
    );
    await fs.writeFile(
      planPath,
      buildZapAutomationPlan(targetUrl, workDir),
      "utf8",
    );

    const proc = await runLocalZapProcess(
      zapBin,
      ["-cmd", "-silent", "-dir", zapHome, "-autorun", planPath],
      cwd,
      ZAP_LOCAL_TIMEOUT_MS,
    );
    await logLocalZapOutput(ctx, proc.output);

    if (proc.timedOut) {
      throw new Error(
        `ZAP local a dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©passÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© le dÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©lai de ${Math.round(
          ZAP_LOCAL_TIMEOUT_MS / 60_000,
        )} min`,
      );
    }
    if (proc.exitCode !== 0) {
      await ctx.log(
        "warn",
        `ZAP local a retournÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© le code ${proc.exitCode} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â lecture du rapport`,
      );
    }

    let content: string;
    try {
      content = await fs.readFile(reportPath, "utf8");
    } catch {
      throw new Error(
        `Rapport ZAP local introuvable (code ${proc.exitCode})`,
      );
    }
    if (!content.trim()) {
      throw new Error("Rapport ZAP local vide");
    }

    let report: ZapReport;
    try {
      report = JSON.parse(content) as ZapReport;
    } catch {
      throw new Error("Impossible de parser le rapport JSON ZAP local");
    }

    const result = parseZapReport(
      report,
      targetUrl,
      Date.now() - started,
      proc.exitCode,
    );

    await persistScanResult(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.DAST,
      },
      result,
    );

    for (const line of result.logs) {
      await ctx.log("info", line);
    }

    return {
      success: true,
      exitCode: 0,
      data: {
        scanner: "zap",
        mode: "local",
        targetUrl,
        vulnerabilityCount: result.vulnerabilityCount,
        severityCounts: result.severityCounts,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°chec de ZAP local : ${msg}`);

    await persistScanResult(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.DAST,
      },
      {
        scanner: "zap",
        status: "FAILED",
        durationMs: Date.now() - started,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs: [],
        error: msg,
      },
    );

    return { success: false, exitCode: 1, error: msg };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
