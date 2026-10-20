// apps/worker/src/steps/sbom/syft.step.ts
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import { parseSyftReport, type SyftReport } from "@devsecops/scanners";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

const SYFT_IMAGE = process.env.SYFT_IMAGE ?? "anchore/syft:latest";
const SYFT_TIMEOUT_MS = 15 * 60_000;

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Génère un SBOM (Software Bill of Materials) de l'image Docker
 * avec Syft, exécuté sur la VM de déploiement.
 */
export async function syftStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { imageTag: true },
  });

  if (!image) {
    await ctx.log("warn", "Aucune image Docker — génération du SBOM ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no docker image" },
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });

  if (!project?.server) {
    await ctx.log("warn", "Aucun serveur associé — SBOM ignoré");
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

  const ssh = new SshRunner();
  const started = Date.now();

  try {
    await ctx.log("info", "Connexion SSH pour la génération du SBOM...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });

    const imageCheck = await ssh.exec(
      `docker image inspect ${shellQuote(SYFT_IMAGE)} >/dev/null 2>&1 && echo OK || echo MISSING`,
      20_000,
    );
    if (imageCheck.stdout.includes("MISSING")) {
      await ctx.log("info", "Téléchargement de l'image Syft...");
      const pullCode = await ssh.execStream(
        `docker pull ${shellQuote(SYFT_IMAGE)}`,
        (chunk, stream) => {
          const line = chunk.trim();
          if (line && stream === "stderr") {
            void ctx.log("debug", `[syft pull] ${line}`);
          }
        },
        10 * 60_000,
      );
      if (pullCode !== 0) {
        throw new Error("Impossible de télécharger l'image Syft");
      }
    }

    await ctx.log("info", `Génération du SBOM Syft pour ${image.imageTag}...`);
    const command = [
      "docker run --rm",
      "-v /var/run/docker.sock:/var/run/docker.sock",
      shellQuote(SYFT_IMAGE),
      shellQuote(image.imageTag),
      "-o json",
      "--quiet",
    ].join(" ");

    const result = await ssh.exec(command, SYFT_TIMEOUT_MS);
    if (result.code !== 0) {
      throw new Error(
        `Syft a échoué (code ${result.code}) : ${result.stderr.slice(0, 500)}`,
      );
    }
    if (!result.stdout.trim()) {
      throw new Error("Syft n'a produit aucun SBOM");
    }

    let report: SyftReport;
    try {
      report = JSON.parse(result.stdout) as SyftReport;
    } catch {
      throw new Error("Impossible de parser le rapport JSON Syft");
    }

    const summary = parseSyftReport(report);

    await prisma.sbom.upsert({
      where: { pipelineId: ctx.pipelineId },
      create: {
        pipelineId: ctx.pipelineId,
        projectId: ctx.projectId,
        format: "syft-json",
        packageCount: summary.packageCount,
        contentJson: summary as unknown as object,
      },
      update: {
        format: "syft-json",
        packageCount: summary.packageCount,
        contentJson: summary as unknown as object,
      },
    });

    await ctx.log(
      "info",
      `SBOM généré : ${summary.packageCount} paquet(s) en ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`,
    );

    return {
      success: true,
      exitCode: 0,
      data: {
        scanner: "syft",
        packageCount: summary.packageCount,
        scannedOnVm: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec de Syft : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}
