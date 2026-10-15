// apps/worker/src/steps/deployment/deployment.step.ts
import { DeploymentStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

// Ports exposés par l'application selon la techno.
const APP_PORT_BY_TECH: Record<string, number> = {
  NODEJS: 3000,
  PHP: 8000,
  PYTHON: 8000,
  UNKNOWN: 80,
};

// Port externe utilisé sur la VM (évite le conflit avec Nginx système).
const EXTERNAL_PORT = 8080;

// ============================================================
// GÉNÉRATION DES FICHIERS DE DÉPLOIEMENT
// ============================================================

function buildComposeFile(
  imageTag: string,
  appPort: number,
  externalPort: number,
): string {
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

// ============================================================
// ÉTAPE DÉPLOIEMENT
// ============================================================

export async function deploymentStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Déploiement : initialisation...");

  // ----------------------------------------------------------
  // 1. Charge le projet + serveur
  // ----------------------------------------------------------
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

  if (!project.server) {
    await ctx.log("warn", "Aucun serveur de déploiement associé — étape ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "no server" },
    };
  }

  const server = project.server;

  // ----------------------------------------------------------
  // 2. Vérifie que la clé SSH est présente (narrowing TypeScript)
  // ----------------------------------------------------------
  if (!server.encryptedPrivateKey) {
    return {
      success: false,
      exitCode: 1,
      error: "Clé SSH du serveur manquante",
    };
  }

  // ----------------------------------------------------------
  // 3. Charge l'image Docker construite sur la VM
  // ----------------------------------------------------------
  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { imageTag: true },
  });

  if (!image) {
    return {
      success: false,
      exitCode: 1,
      error: "Aucune image Docker trouvée pour ce pipeline",
    };
  }

  await ctx.log(
    "info",
    `Serveur cible : ${server.name} (${server.host}:${server.sshPort})`,
  );
  await ctx.log("info", `Image à déployer : ${image.imageTag}`);

  // ----------------------------------------------------------
  // 4. Crée l'entrée Deployment
  // ----------------------------------------------------------
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
    select: { id: true, startedAt: true },
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

  const ssh = new SshRunner();

  // ----------------------------------------------------------
  // 5. Déchiffre la clé SSH
  // ----------------------------------------------------------
  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.FAILED,
        finishedAt: new Date(),
        error: "Impossible de déchiffrer la clé SSH",
      },
    });
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de déchiffrer la clé SSH",
    };
  }

  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  try {
    // --------------------------------------------------------
    // 6. Connexion SSH
    // --------------------------------------------------------
    await ctx.log("info", "Connexion SSH...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });
    await ctx.log("info", "SSH connecté");

    // --------------------------------------------------------
    // 7. Prépare le répertoire distant
    // --------------------------------------------------------
    const prep = await ssh.exec(
      `mkdir -p "${remoteDir}" && cd "${remoteDir}" && pwd`,
      30_000,
    );
    if (prep.code !== 0) {
      throw new Error(`Préparation dossier distant échouée : ${prep.stderr}`);
    }
    await ctx.log("info", `Répertoire distant prêt : ${remoteDir}`);

    // --------------------------------------------------------
    // 8. Écrit les fichiers de configuration
    // --------------------------------------------------------
    await ctx.log("info", "Écriture de docker-compose.yml et nginx.conf...");
    await ssh.writeRemoteFile(
      `${remoteDir}/docker-compose.yml`,
      buildComposeFile(image.imageTag, appPort, EXTERNAL_PORT),
    );
    await ssh.writeRemoteFile(`${remoteDir}/nginx.conf`, buildNginxConf(appPort));

    // --------------------------------------------------------
    // 9. Démarre les conteneurs
    // --------------------------------------------------------
    await ctx.log("info", "Lancement des conteneurs (docker compose up -d)...");
    const upCode = await ssh.execStream(
      `cd "${remoteDir}" && docker compose up -d --remove-orphans`,
      (chunk, stream) => {
        const line = chunk.trim();
        if (!line) return;
        for (const l of line.split("\n")) {
          if (l.trim()) {
            void ctx.log(
              stream === "stderr" ? "debug" : "info",
              `[compose] ${l}`,
            );
          }
        }
      },
      5 * 60_000,
    );

    if (upCode !== 0) {
      throw new Error(`docker compose up a échoué (code ${upCode})`);
    }

    // --------------------------------------------------------
    // 10. Healthcheck HTTP
    // --------------------------------------------------------
    const appUrl = `http://${server.host}:${EXTERNAL_PORT}`;
    await ctx.log("info", `Healthcheck sur ${appUrl}...`);

    await new Promise((r) => setTimeout(r, 5_000));

    const health = await ssh.exec(
      `curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "${appUrl}/" || echo "FAILED"`,
      20_000,
    );

    const httpCode = health.stdout.trim();
    if (httpCode === "FAILED" || !/^[23]/.test(httpCode)) {
      await ctx.log("warn", `Healthcheck retourne : ${httpCode} (non bloquant)`);
    } else {
      await ctx.log("info", `Healthcheck OK (HTTP ${httpCode})`);
    }

    // --------------------------------------------------------
    // 11. Persiste le succès
    // --------------------------------------------------------
    const finishedAt = new Date();
    const durationMs = deployment.startedAt
      ? finishedAt.getTime() - deployment.startedAt.getTime()
      : null;

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.SUCCESS,
        finishedAt,
        durationMs,
        url: appUrl,
      },
    });

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
    await ssh.disconnect().catch(() => undefined);
  }
}