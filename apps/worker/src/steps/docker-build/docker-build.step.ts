// apps/worker/src/steps/docker-build/docker-build.step.ts
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import * as tar from "tar";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

// ============================================================
// GÉNÉRATION DU DOCKERFILE PAR DÉFAUT
// ============================================================
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function generateDockerfile(tech: string): string {
  if (tech === "NODEJS") {
    return [
      "FROM node:22-alpine",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 3000",
      'CMD ["node", "index.js"]',
    ].join("\n");
  }
  if (tech === "PHP") {
    return [
      "FROM php:8.3-cli",
      "WORKDIR /app",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 8000",
      'CMD ["php", "-S", "0.0.0.0:8000"]',
    ].join("\n");
  }
  if (tech === "PYTHON") {
    return [
      "FROM python:3.12-slim",
      "WORKDIR /app",
      "COPY requirements.txt* pyproject.toml* ./",
      "RUN (test -f requirements.txt && pip install --no-cache-dir -r requirements.txt) || (test -f pyproject.toml && pip install --no-cache-dir .) || true",
      "COPY . .",
      "RUN rm -f .devsecops.Dockerfile",
      "EXPOSE 8000",
      'CMD ["python", "-m", "http.server", "8000"]',
    ].join("\n");
  }
  return [
    "FROM alpine:latest",
    "WORKDIR /app",
    "COPY . .",
    "RUN rm -f .devsecops.Dockerfile",
    'CMD ["sleep", "3600"]',
  ].join("\n");
}

async function detectTech(workspaceDir: string): Promise<string> {
  if (await fileExists(path.join(workspaceDir, "package.json"))) return "NODEJS";
  if (await fileExists(path.join(workspaceDir, "composer.json"))) return "PHP";
  if (await fileExists(path.join(workspaceDir, "requirements.txt"))) return "PYTHON";
  if (await fileExists(path.join(workspaceDir, "pyproject.toml"))) return "PYTHON";
  return "UNKNOWN";
}

// ============================================================
// ÉTAPE BUILD
// ============================================================
export async function dockerBuildStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const imageTag = `devsecops/${ctx.projectId}:${ctx.commitSha.slice(0, 12)}`;

  // 1. Charge le serveur de déploiement du projet
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });

  if (!project) {
    return { success: false, exitCode: 1, error: "Projet introuvable" };
  }

  if (!project.server) {
    return {
      success: false,
      exitCode: 1,
      error:
        "Aucun serveur de déploiement associé au projet — impossible de construire l'image (Docker est sur la VM).",
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

  // 2. Prépare le Dockerfile
  let dockerfileArg = "Dockerfile";
  let generated = false;

  const dockerfilePath = path.join(ctx.workspaceDir, "Dockerfile");
  if (!(await fileExists(dockerfilePath))) {
    await ctx.log("warn", "Aucun Dockerfile fourni — génération automatique");
    const tech = await detectTech(ctx.workspaceDir);
    await ctx.log("info", `Technologie détectée pour le Dockerfile : ${tech}`);

    const content = generateDockerfile(tech);
    await fs.writeFile(
      path.join(ctx.workspaceDir, ".devsecops.Dockerfile"),
      content,
      "utf8",
    );
    dockerfileArg = ".devsecops.Dockerfile";
    generated = true;
  } else {
    await ctx.log("info", "Dockerfile trouvé dans le repository");
  }

  // 3. Crée l'archive tar.gz du workspace
  const archivePath = path.join(
    os.tmpdir(),
    `devsecops-build-${ctx.pipelineId}.tar.gz`,
  );

  await ctx.log("info", "Préparation de l'archive source...");
  try {
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: ctx.workspaceDir,
        portable: true,
      },
      ["."],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec de création de l'archive : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  }

  const stat = await fs.stat(archivePath);
  await ctx.log(
    "info",
    `Archive créée (${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
  );

  // 4. Connexion SSH
  const ssh = new SshRunner();
  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch (err) {
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de déchiffrer la clé SSH du serveur",
    };
  }

  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const remoteDir = `/home/${server.username}/apps/${ctx.projectId}/build-${ctx.pipelineId}`;
  const remoteArchive = `${remoteDir}/source.tar.gz`;

  try {
    await ctx.log("info", "Connexion SSH à la VM de build...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });

    // 5. Prépare le répertoire distant
    const prep = await ssh.exec(`mkdir -p "${remoteDir}" && cd "${remoteDir}" && pwd`);
    if (prep.code !== 0) {
      throw new Error(`Préparation du dossier distant échouée : ${prep.stderr}`);
    }

    // 6. Upload de l'archive
    await ctx.log("info", "Envoi de l'archive source vers la VM...");
    await ssh.uploadFile(archivePath, remoteArchive);

    // 7. Extraction
    await ctx.log("info", "Extraction de l'archive sur la VM...");
    const extractCode = await ssh.execStream(
      `cd "${remoteDir}" && tar -xzf source.tar.gz && rm -f source.tar.gz && ls -la | head -5`,
      (chunk, stream) => {
        if (stream === "stderr") {
          const line = chunk.trim();
          if (line) void ctx.log("debug", `[tar] ${line}`);
        }
      },
      2 * 60_000,
    );
    if (extractCode !== 0) {
      throw new Error(`Extraction tar échouée (code ${extractCode})`);
    }

    // 8. Build sur la VM
    await ctx.log("info", `Build de l'image ${imageTag} sur la VM...`);
    const buildStart = Date.now();

    const buildCode = await ssh.execStream(
      `cd "${remoteDir}" && docker build -f "${dockerfileArg}" -t "${imageTag}" --label devsecops.pipeline=${ctx.pipelineId} --label devsecops.project=${ctx.projectId} .`,
      (chunk, stream) => {
        const trimmed = chunk.trim();
        if (!trimmed) return;
        // Découpe en lignes pour un affichage propre
        for (const line of trimmed.split("\n")) {
          if (!line.trim()) continue;
          void ctx.log(
            stream === "stderr" ? "debug" : "info",
            `[build] ${line}`,
          );
        }
      },
      20 * 60_000,
    );

    if (buildCode !== 0) {
      throw new Error(`docker build a échoué (code ${buildCode})`);
    }

    const buildDuration = Date.now() - buildStart;
    await ctx.log(
      "info",
      `Build réussi en ${(buildDuration / 1000).toFixed(1)}s`,
    );

    // 9. Récupère l'ID et la taille de l'image
    let imageId: string | null = null;
    let sizeBytes: bigint | null = null;

    try {
      const idResult = await ssh.exec(
        `docker inspect --format '{{.Id}}' "${imageTag}"`,
        30_000,
      );
      if (idResult.code === 0) imageId = idResult.stdout.trim();

      const sizeResult = await ssh.exec(
        `docker inspect --format '{{.Size}}' "${imageTag}"`,
        30_000,
      );
      if (sizeResult.code === 0) {
        const parsed = Number.parseInt(sizeResult.stdout.trim(), 10);
        if (!Number.isNaN(parsed)) sizeBytes = BigInt(parsed);
      }
    } catch {
      await ctx.log("warn", "Impossible d'inspecter l'image");
    }

    await ctx.log(
      "info",
      `Image : ${imageTag}${
        sizeBytes ? ` (${(Number(sizeBytes) / 1024 / 1024).toFixed(1)} MB)` : ""
      }`,
    );

    // 10. Persiste dans DockerImage
    await prisma.dockerImage.upsert({
      where: { pipelineId: ctx.pipelineId },
      create: {
        pipelineId: ctx.pipelineId,
        imageTag,
        imageId,
        sizeBytes,
        registry: "vm-local",
      },
      update: {
        imageTag,
        imageId,
        sizeBytes,
        registry: "vm-local",
      },
    });

    return {
      success: true,
      exitCode: 0,
      data: {
        imageTag,
        imageId,
        sizeBytes: sizeBytes ? Number(sizeBytes) : null,
        buildDurationMs: buildDuration,
        builtOnVm: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec du build Docker : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  } finally {
    // Nettoyage local
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    // Nettoyage du Dockerfile généré
    if (generated) {
      await fs
        .rm(path.join(ctx.workspaceDir, ".devsecops.Dockerfile"), {
          force: true,
        })
        .catch(() => undefined);
    }
    // Nettoyage distant
    await ssh
      .exec(`rm -rf "${remoteDir}"`, 30_000)
      .catch(() => undefined);
    await ssh.disconnect().catch(() => undefined);
  }
}