// apps/worker/src/steps/deployment/deployment.step.ts
import { DeploymentStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  APP_PORT_BY_TECH,
  PRODUCTION_PORT,
  deployCompose,
  stopLegacyDeployment,
} from "./deploy.helper";

/**
 * Étape de déploiement.
 *
 * - stratégie `direct` : déploie directement en production (port 8080) ;
 * - stratégie `staging_then_production` : déploie d'abord sur le port
 *   de staging (8081 par défaut). La promotion en production est faite
 *   par l'étape PROMOTE, après le DAST et le second Security Gate.
 */
export async function deploymentStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Déploiement : initialisation...");

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true, config: true },
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

  const stagingStrategy =
    project.config?.deploymentStrategy === "staging_then_production";
  const environment: "STAGING" | "PRODUCTION" = stagingStrategy
    ? "STAGING"
    : "PRODUCTION";
  const externalPort = stagingStrategy
    ? (project.config?.stagingPort ?? 8081)
    : PRODUCTION_PORT;

  const appPort = APP_PORT_BY_TECH[project.technology] ?? 80;
  const remoteDir = `/home/${server.username}/apps/${project.id}/${environment.toLowerCase()}`;

  await ctx.log(
    "info",
    `Serveur cible : ${server.name} (${server.host}:${server.sshPort})`,
  );
  await ctx.log("info", `Image à déployer : ${image.imageTag}`);
  await ctx.log(
    "info",
    `Environnement : ${environment} — port ${externalPort}`,
  );

  const deployment = await prisma.deployment.create({
    data: {
      pipelineId: ctx.pipelineId,
      projectId: ctx.projectId,
      serverId: server.id,
      status: DeploymentStatus.RUNNING,
      environment,
      startedAt: new Date(),
      imageTag: image.imageTag,
      releaseVersion: ctx.commitSha.slice(0, 12),
      ...(stagingStrategy ? { stagingStatus: DeploymentStatus.RUNNING } : {}),
    },
    select: { id: true, startedAt: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: project.ownerId,
      action: "DEPLOYMENT_STARTED",
      targetType: "Deployment",
      targetId: deployment.id,
      metadataJson: {
        serverId: server.id,
        imageTag: image.imageTag,
        environment,
        externalPort,
      },
    },
  });

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

  const ssh = new SshRunner();

  try {
    await ctx.log("info", "Connexion SSH...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });

    if (!stagingStrategy) {
      await stopLegacyDeployment(
        ssh,
        ctx,
        `/home/${server.username}/apps/${project.id}`,
      );
    }

    const result = await deployCompose({
      ssh,
      ctx,
      remoteDir,
      imageTag: image.imageTag,
      appPort,
      externalPort,
      environment,
      serverHost: server.host,
    });

    if (!result.healthy) {
      throw new Error(
        `Healthcheck ${environment} échoué (HTTP ${result.httpCode})`,
      );
    }

    const finishedAt = new Date();
    const durationMs = deployment.startedAt
      ? finishedAt.getTime() - deployment.startedAt.getTime()
      : null;

    if (stagingStrategy) {
      // Le déploiement de staging est réussi, mais la production n'est
      // pas encore faite : l'étape PROMOTE finalisera l'enregistrement.
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.RUNNING,
          environment: "STAGING",
          stagingUrl: result.url,
          stagingStatus: DeploymentStatus.SUCCESS,
          url: result.url,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: project.ownerId,
          action: "DEPLOYMENT_STAGING_SUCCEEDED",
          targetType: "Deployment",
          targetId: deployment.id,
          metadataJson: { url: result.url, externalPort },
        },
      });

      await ctx.log(
        "info",
        `Staging déployé et healthy : ${result.url}. En attente du DAST et de la promotion.`,
      );

      return {
        success: true,
        exitCode: 0,
        data: {
          deploymentId: deployment.id,
          environment: "STAGING",
          url: result.url,
          imageTag: image.imageTag,
          externalPort,
          appPort,
        },
      };
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.SUCCESS,
        environment: "PRODUCTION",
        productionUrl: result.url,
        productionStatus: DeploymentStatus.SUCCESS,
        url: result.url,
        finishedAt,
        durationMs,
      },
    });

    await ctx.log("info", `Déploiement réussi : ${result.url}`);

    return {
      success: true,
      exitCode: 0,
      data: {
        deploymentId: deployment.id,
        environment: "PRODUCTION",
        url: result.url,
        imageTag: image.imageTag,
        externalPort,
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
        ...(stagingStrategy
          ? { stagingStatus: DeploymentStatus.FAILED }
          : { productionStatus: DeploymentStatus.FAILED }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: project.ownerId,
        action: "DEPLOYMENT_FAILED",
        targetType: "Deployment",
        targetId: deployment.id,
        metadataJson: { error: msg, environment },
      },
    });

    return { success: false, exitCode: 1, error: msg };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}
