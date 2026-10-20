// apps/worker/src/steps/dynamic-scan/zap.step.ts
import { ScanType } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import { persistScanResult } from "../../orchestrator/scanner.helper";
import { parseZapReport, type ZapReport } from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

const ZAP_IMAGE = process.env.ZAP_IMAGE ?? "ghcr.io/zaproxy/zaproxy:stable";
const ZAP_TIMEOUT_MS = 20 * 60_000;

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Scan DAST OWASP ZAP.
 *
 * ZAP s'exécute dans un conteneur Docker sur la VM de déploiement,
 * contre l'URL de l'application déployée par ce pipeline. Le rapport
 * JSON est récupéré puis normalisé par `parseZapReport`.
 */
export async function zapStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  // 1. Récupère le déploiement de ce pipeline.
  const deployment = await prisma.deployment.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { id: true, status: true, url: true, imageTag: true },
  });

  if (!deployment || !deployment.url) {
    await ctx.log(
      "warn",
      "Aucun déploiement réussi pour ce pipeline — scan ZAP ignoré",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no deployment" },
    };
  }

  // 2. Charge le projet et le serveur de déploiement.
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });
  if (!project?.server) {
    await ctx.log("warn", "Aucun serveur associé — scan ZAP ignoré");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no server" },
    };
  }
  const server = project.server;

  if (!server.encryptedPrivateKey) {
    return {
      success: false,
      exitCode: 1,
      error: "Clé SSH du serveur manquante",
    };
  }

  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de déchiffrer la clé SSH",
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

    // 3. Vérifie / télécharge l'image ZAP.
    const imageCheck = await ssh.exec(
      `docker image inspect ${shellQuote(ZAP_IMAGE)} >/dev/null 2>&1 && echo OK || echo MISSING`,
      20_000,
    );
    if (imageCheck.stdout.includes("MISSING")) {
      await ctx.log("info", "Téléchargement de l'image OWASP ZAP...");
      const pullCode = await ssh.execStream(
        `docker pull ${shellQuote(ZAP_IMAGE)}`,
        (chunk, stream) => {
          const line = chunk.trim();
          if (line && stream === "stderr") {
            void ctx.log("debug", `[zap pull] ${line}`);
          }
        },
        10 * 60_000,
      );
      if (pullCode !== 0) {
        throw new Error("Impossible de télécharger l'image OWASP ZAP");
      }
    }

    // 4. Lance le baseline scan.
    await ctx.log("info", "Exécution du scan OWASP ZAP (baseline)...");
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
      throw new Error("ZAP a signalé une erreur technique (code 2)");
    }
    if (exitCode === 1) {
      await ctx.log("info", "ZAP a détecté des alertes (code 1) — analyse du rapport");
    }

    // 5. Récupère et parse le rapport JSON.
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
    await ctx.log("error", `Échec de ZAP : ${msg}`);

    // Persiste un scan FAILED pour que le Security Gate détecte
    // l'échec technique au lieu de considérer 0 vulnérabilité.
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
