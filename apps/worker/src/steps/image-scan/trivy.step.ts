// apps/worker/src/steps/image-scan/trivy.step.ts
import { ScanOutcome, ScanType } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import {
  persistScanFailure,
  persistScanResult,
} from "../../orchestrator/scanner.helper";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import type {
  ScanResult,
  NormalizedFinding,
  ScannerSeverity,
} from "@devsecops/scanners";

// ============================================================
// CONFIGURATION TRIVY
// ============================================================

// Volume Docker persistant contenant la DB Trivy prÃ©-tÃ©lÃ©chargÃ©e.
// Structure attendue : <volume>/trivy/db/{trivy.db,metadata.json}
const TRIVY_VOLUME =
  process.env.TRIVY_VM_CACHE_VOLUME?.trim() || "trivy-cache";
// Image Trivy exÃ©cutÃ©e sur la VM.
const TRIVY_IMAGE =
  process.env.TRIVY_VM_IMAGE?.trim() || "aquasec/trivy:latest";
// Le cache Trivy est montÃ© sur /root/.cache ; Trivy utilise /root/.cache/trivy.
const TRIVY_CACHE_MOUNT = "/root/.cache";
const TRIVY_DB_DIR = "/root/.cache/trivy/db";
// Timeout du scan complet
const TRIVY_SCAN_TIMEOUT_MS = 15 * 60_000;

// ============================================================
// TYPES TRIVY
// ============================================================

interface TrivyOutput {
  Results?: Array<{
    Target?: string;
    Class?: string;
    Type?: string;
    Vulnerabilities?: Array<{
      VulnerabilityID?: string;
      PkgName?: string;
      InstalledVersion?: string;
      FixedVersion?: string;
      Severity?: string;
      Title?: string;
      Description?: string;
      PrimaryURL?: string;
    }>;
  }>;
}

// ============================================================
// HELPERS
// ============================================================

function mapSeverity(s: string | undefined): ScannerSeverity {
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

function countSeverities(findings: NormalizedFinding[]) {
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

// ============================================================
// Ã‰TAPE TRIVY
// ============================================================

export async function trivyStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  // 1. RÃ©cupÃ¨re l'image Docker
  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { imageTag: true },
  });

  if (!image) {
    await ctx.log("warn", "Aucune image Docker associée — échec technique Trivy");
    await persistScanFailure(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.IMAGE,
      },
      {
        scanner: "trivy",
        outcome: ScanOutcome.REQUIRED_NOT_RUN,
        reason: "no docker image",
      },
    );
    return {
      success: true,
      exitCode: 0,
      data: {
        skipped: true,
        technical: true,
        outcome: "REQUIRED_NOT_RUN",
        reason: "no docker image",
      },
    };
  }

  // 2. Charge le projet + serveur
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });

  if (!project?.server) {
    return {
      success: false,
      exitCode: 1,
      error: "Aucun serveur associÃ© â€” impossible de scanner l'image",
    };
  }

  const server = project.server;

  if (!server.encryptedPrivateKey) {
    return {
      success: false,
      exitCode: 1,
      error: "ClÃ© SSH du serveur manquante",
    };
  }

  const ssh = new SshRunner();
  const startTime = Date.now();
  const logs: string[] = [];

  // 3. DÃ©chiffre la clÃ© SSH
  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de dÃ©chiffrer la clÃ© SSH",
    };
  }

  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  try {
    // 4. Connexion SSH
    await ctx.log("info", "Connexion SSH pour le scan Trivy...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });

    // 5. VÃ©rifie la prÃ©sence de l'image Trivy (pull si absent)
    await ctx.log("info", "VÃ©rification de l'image Trivy sur la VM...");
    const imageCheck = await ssh.exec(
      `docker image inspect ${TRIVY_IMAGE} >/dev/null 2>&1 && echo OK || echo MISSING`,
      15_000,
    );

    if (imageCheck.stdout.includes("MISSING")) {
      await ctx.log("info", "TÃ©lÃ©chargement de l'image Trivy...");
      const pullCode = await ssh.execStream(
        `docker pull ${TRIVY_IMAGE}`,
        (chunk, stream) => {
          const line = chunk.trim();
          if (line && stream === "stderr") {
            void ctx.log("debug", `[pull] ${line}`);
          }
        },
        10 * 60_000,
      );
      if (pullCode !== 0) {
        throw new Error("Impossible de tÃ©lÃ©charger l'image Trivy");
      }
    }

    // 6. VÃ©rifie que la DB Trivy est prÃ©sente dans le volume.
    //    On refuse de lancer le scan sans DB : sinon Trivy tenterait un
    //    tÃ©lÃ©chargement rÃ©seau et Ã©chouerait avec un timeout.
    await ctx.log("info", "VÃ©rification de la base Trivy locale...");
    const dbCheck = await ssh.exec(
      `docker run --rm -v ${TRIVY_VOLUME}:${TRIVY_CACHE_MOUNT} --entrypoint sh ${TRIVY_IMAGE} ` +
        `-c 'test -s ${TRIVY_DB_DIR}/trivy.db && test -s ${TRIVY_DB_DIR}/metadata.json && echo CACHE_OK || echo CACHE_MISSING'`,
      2 * 60_000,
    );

    if (!dbCheck.stdout.includes("CACHE_OK")) {
      throw new Error(
        `Base de vulnÃ©rabilitÃ©s Trivy absente sur la VM (volume ${TRIVY_VOLUME}). ` +
          `Placez trivy.db et metadata.json dans ${TRIVY_DB_DIR} du volume, ` +
          "ou exÃ©cutez la prÃ©paration du cache Trivy.",
      );
    }

    await ctx.log(
      "info",
      "Base Trivy locale dÃ©tectÃ©e â€” mise Ã  jour rÃ©seau dÃ©sactivÃ©e pour ce scan",
    );

    // 7. Scan Trivy avec le volume de cache, sans aucun tÃ©lÃ©chargement.
    await ctx.log("info", `Scan Trivy de l'image ${image.imageTag}...`);
    const trivyStart = Date.now();

    const scanCmd = [
      "docker run --rm",
      "-v /var/run/docker.sock:/var/run/docker.sock",
      `-v ${TRIVY_VOLUME}:${TRIVY_CACHE_MOUNT}`,
      TRIVY_IMAGE,
      "image",
      "--skip-db-update",
      "--skip-java-db-update",
      "--skip-version-check",
      "--format json",
      "--quiet",
      "--no-progress",
      "--severity CRITICAL,HIGH,MEDIUM,LOW",
      `"${image.imageTag}"`,
    ].join(" ");

    const scanResult = await ssh.exec(scanCmd, TRIVY_SCAN_TIMEOUT_MS);

    if (scanResult.code !== 0) {
      throw new Error(
        `Trivy a Ã©chouÃ© (code ${scanResult.code}) : ${scanResult.stderr.slice(0, 500)}`,
      );
    }

    const trivyDuration = Date.now() - trivyStart;
    await ctx.log(
      "info",
      `Trivy terminÃ© en ${(trivyDuration / 1000).toFixed(1)}s`,
    );

    // 8. Parse le JSON
    let parsed: TrivyOutput;
    try {
      parsed = JSON.parse(scanResult.stdout) as TrivyOutput;
    } catch (parseErr) {
      const message =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(`Impossible de parser le JSON Trivy : ${message}`);
    }

    const findings: NormalizedFinding[] = [];
    for (const r of parsed.Results ?? []) {
      for (const v of r.Vulnerabilities ?? []) {
        findings.push({
          tool: "trivy",
          severity: mapSeverity(v.Severity),
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

    const severityCounts = countSeverities(findings);
    logs.push(
      `[info] Trivy : ${findings.length} vulnÃ©rabilitÃ©(s) â€” ` +
        `critical=${severityCounts.critical}, high=${severityCounts.high}, ` +
        `medium=${severityCounts.medium}, low=${severityCounts.low}`,
    );

    const normalizedScan: ScanResult = {
      scanner: "trivy",
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      exitCode: 0,
      vulnerabilityCount: findings.length,
      severityCounts,
      findings,
      logs,
    };

    // 9. Persiste
    await persistScanResult(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.IMAGE,
      },
      normalizedScan,
    );

    await ctx.log(
      "info",
      `Trivy : ${findings.length} vulnÃ©rabilitÃ©(s) â€” ` +
        `critical=${severityCounts.critical}, high=${severityCounts.high}`,
    );

    return {
      success: true,
      exitCode: 0,
      data: {
        scanner: "trivy",
        outcome:
          findings.length > 0
            ? "SUCCESS_WITH_FINDINGS"
            : "SUCCESS_NO_FINDINGS",
        vulnerabilityCount: findings.length,
        severityCounts,
        scannedOnVm: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Ã‰chec de Trivy : ${msg}`);
    const parseFailure = msg.toLowerCase().includes("parser");

    await persistScanResult(
      {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        type: ScanType.IMAGE,
      },
      {
        scanner: "trivy",
        status: "FAILED",
        durationMs: Date.now() - startTime,
        exitCode: null,
        vulnerabilityCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        logs,
        error: msg,
      },
      {
        outcome: parseFailure
          ? ScanOutcome.PARSE_ERROR
          : ScanOutcome.INTERRUPTED,
      },
    );

    return {
      success: false,
      exitCode: 1,
      error: msg,
      data: {
        outcome: parseFailure ? "PARSE_ERROR" : "INTERRUPTED",
        reason: msg,
      },
    };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}