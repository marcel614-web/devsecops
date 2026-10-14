// apps/worker/src/steps/deployment/deployment.step.ts
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { DeploymentStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { logger } from "../../utils/logger";
import { SshRunner } from "../../runners/ssh.runner";
import { decryptString } from "../../utils/crypto";
import { execFileAsync } from "../../orchestrator/step.executor";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

// Ports exposés par l'application selon la techno.
const APP_PORT_BY_TECH: Record<string, number> = {
  NODEJS: 3000,
  PHP: 8000,
  PYTHON: 8000,
  UNKNOWN: 80,
};

// Port externe utilisé sur la VM pour exposer l'application.
// On évite 80 pour ne pas entrer en conflit avec le Nginx système.
const EXTERNAL_PORT = 8080;

/**
 * Construit le docker-compose.yml déployé sur la VM.
 */
function buildComposeFile(imageTag: string, appPort: number, externalPort: number): string {
  return `services:
  app:
    image: ${imageTag}
    restart: unless-stopped
    expose:
      - "${appPort}"
    environment:
      - NODE_ENV=production
      - PORT=${appPort}
    networks:
      - devsecops

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "${externalPort}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    networks:
      - devsecops

networks:
  devsecops:
    driver: bridge
`;
}

/**
 * Construit le nginx.conf qui redirige vers le conteneur app.
 */
function buildNginxConf(appPort: number): string {
  return `server {
  listen 80;
  server_name _;

  location / {
    proxy_pass http://app:${appPort};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
`;
}

/**
 * Sauvegarde l'image Docker en archive tar.gz locale.
 */
async function saveImageLocally(imageTag: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `devsecops-image-${Date.now()}.tar.gz`);

  // docker save image | gzip > file.tar.gz
  // On utilise sh pour gérer le pipe.
  await execFileAsync(
    "sh",
    ["-c", `docker save ${imageTag} | gzip > "${tmpPath}"`],
    { timeout: 15 * 60_000, shell: true },
  );

  return tmpPath;
}

export async function deploymentStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Déploiement : initialisation...");

  // ------------------------------------------------------------
  // 1. Charge le projet + serveur
  // ------------------------------------------------------------
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });

  if (!project) {
    return { success: false, exitCode: 1, error: "Projet introuvable" };
  }

  if (!project.deploymentEnabled) {
    await ctx.log("warn", "Déploiement désactivé pour ce projet — étape ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "deployment disabled" },
    };
  }

  if (!project.serverId || !project.server) {
    await ctx.log("warn", "Aucun serveur de déploiement associé — étape ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no server" },
    };
  }

  const server = project.server;

  // ------------------------------------------------------------
  // 2. Charge l'image Docker
  // ------------------------------------------------------------
  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
  });

  if (!image) {
    return {
      success: false,
      exitCode: 1,
      error: "Aucune image Docker trouvée pour ce pipeline",
    };
  }

  await ctx.log("info", `Serveur cible : ${server.name} (${server.host}:${server.sshPort})`);
  await ctx.log("info", `Image à déployer : ${image.imageTag}`);

  // ------------------------------------------------------------
  // 3. Crée l'entrée Deployment
  // ------------------------------------------------------------
  const deployment = await prisma.deployment.create({
    data: {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      serverId: server.id,
      status: DeploymentStatus.RUNNING,
      startedAt: new Date(),
      imageTag: image.imageTag,
      releaseVersion: ctx.commitSha.slice(0, 12),
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: project.ownerId,
      action: "DEPLOYMENT_STARTED",
      targetType: "Deployment",
      targetId: deployment.id,
      metadataJson: { serverId: server.id, imageTag: image.imageTag },
    },
  });

  const appPort = APP_PORT_BY_TECH[project.technology] ?? 80;
  const remoteDir = `/home/${server.username}/apps/${project.id}`;
  const remoteImagePath = `${remoteDir}/image.tar.gz`;

  const ssh = new SshRunner();
  let localImagePath: string | null = null;

  try {
    // ----------------------------------------------------------
    // 4. Connexion SSH
    // ----------------------------------------------------------
    await ctx.log("info", "Connexion SSH...");
    const privateKey = decryptString(
      (await prisma.deploymentServer.findUniqueOrThrow({
        where: { id: server.id },
        select: { encryptedPrivateKey: true, encryptedPassphrase: true },
      })).encryptedPrivateKey ?? "",
    );

    const passphrase = server.encryptedPassphrase
      ? decryptString(server.encryptedPassphrase)
      : undefined;

    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });
    await ctx.log("info", "SSH connecté");

    // ----------------------------------------------------------
    // 5. Préparation du répertoire distant
    // ----------------------------------------------------------
    const prep = await ssh.exec(`mkdir -p ${remoteDir} && cd ${remoteDir} && pwd`, 30_000);
    if (prep.code !== 0) {
      throw new Error(`Préparation du dossier distant échouée : ${prep.stderr}`);
    }
    await ctx.log("info", `Répertoire distant prêt : ${remoteDir}`);

    // ----------------------------------------------------------
    // 6. Écriture du docker-compose.yml + nginx.conf
    // ----------------------------------------------------------
    await ctx.log("info", "Écriture de docker-compose.yml et nginx.conf...");
    await ssh.writeRemoteFile(
      `${remoteDir}/docker-compose.yml`,
      buildComposeFile(image.imageTag, appPort, EXTERNAL_PORT),
    );
    await ssh.writeRemoteFile(
      `${remoteDir}/nginx.conf`,
      buildNginxConf(appPort),
    );

    // ----------------------------------------------------------
    // 7. Transfert de l'image Docker
    // ----------------------------------------------------------
    await ctx.log("info", "Sauvegarde locale de l'image Docker...");
    localImagePath = await saveImageLocally(image.imageTag);
    const stat = await fs.stat(localImagePath);
    await ctx.log(
      "info",
      `Archive créée : ${(stat.size / 1024 / 1024).toFixed(1)} MB — envoi en cours...`,
    );

    await ssh.uploadFile(localImagePath, remoteImagePath);
    await ctx.log("info", "Archive transférée — chargement de l'image...");

    const loadCode = await ssh.execStream(
      `docker load -i ${remoteImagePath}`,
      (chunk, stream) => {
        const line = chunk.trim();
        if (line) void ctx.log(stream === "stderr" ? "debug" : "info", `[load] ${line}`);
      },
      10 * 60_000,
    );
    if (loadCode !== 0) {
      throw new Error(`docker load a échoué (code ${loadCode})`);
    }
    await ctx.log("info", "Image chargée sur le serveur");

    // ----------------------------------------------------------
    // 8. Démarrage des conteneurs
    // ----------------------------------------------------------
    await ctx.log("info", "Lancement des conteneurs (docker compose up -d)...");
    const upCode = await ssh.execStream(
      `cd ${remoteDir} && docker compose up -d --remove-orphans`,
      (chunk, stream) => {
        const line = chunk.trim();
        if (line) void ctx.log(stream === "stderr" ? "debug" : "info", `[compose] ${line}`);
      },
      5 * 60_000,
    );
    if (upCode !== 0) {
      throw new Error(`docker compose up a échoué (code ${upCode})`);
    }

    // ----------------------------------------------------------
    // 9. Healthcheck HTTP
    // ----------------------------------------------------------
    const appUrl = `http://${server.host}:${EXTERNAL_PORT}`;
    await ctx.log("info", `Healthcheck sur ${appUrl}...`);

    await new Promise((r) => setTimeout(r, 5000)); // laisse le temps aux conteneurs de démarrer

    const healthCmd = `curl -sS -o /dev/null -w "%{http_code}" --max-time 10 ${appUrl}/ || echo "FAILED"`;
    const health = await ssh.exec(healthCmd, 20_000);
    const httpCode = health.stdout.trim();

    if (httpCode === "FAILED" || !/^[23]/.test(httpCode)) {
      await ctx.log("warn", `Healthcheck retourne : ${httpCode} (non bloquant)`);
    } else {
      await ctx.log("info", `Healthcheck OK (HTTP ${httpCode})`);
    }

    // ----------------------------------------------------------
    // 10. Persiste le succès
    // ----------------------------------------------------------
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - (deployment ? new Date().getTime() : finishedAt.getTime());

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.SUCCESS,
        finishedAt,
        durationMs: finishedAt.getTime() - (new Date()).getTime(), // sera recalculé
        url: appUrl,
        imageTag: image.imageTag,
      },
    });

    // Correction : calcule la durée correctement
    const dep = await prisma.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
    if (dep.startedAt) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { durationMs: finishedAt.getTime() - dep.startedAt.getTime() },
      });
    }

    await ctx.log("info", `Déploiement réussi : ${appUrl}`);

    return {
      success: true,
      exitCode: 0,
      data: {
        deploymentId: deployment.id,
        url: appUrl,
        imageTag: image.imageTag,
        externalPort: EXTERNAL_PORT,
        appPort,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Échec du déploiement : ${msg}`);

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.FAILED,
        finishedAt: new Date(),
        error: msg,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: project.ownerId,
        action: "DEPLOYMENT_FAILED",
        targetType: "Deployment",
        targetId: deployment.id,
        metadataJson: { error: msg },
      },
    });

    return { success: false, exitCode: 1, error: msg };
  } finally {
    // Nettoyage local
    if (localImagePath) {
      await fs.rm(localImagePath, { force: true }).catch(() => undefined);
    }
    // Nettoyage distant
    await ssh.exec(`rm -f ${remoteImagePath}`, 30_000).catch(() => undefined);
    await ssh.disconnect().catch(() => undefined);
  }
}