// apps/worker/src/steps/deployment/promotion.step.ts
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
 * Promotion staging → production.
 *
 * Ne s'exécute que pour la stratégie `staging_then_production`, après
 * le DAST et le second Security Gate. En cas d'échec du healthcheck,
 * tente un retour arrière vers la dernière image de production connue
 * (si `autoRollback` est activé).
 */
export async function promotionStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  await ctx.log("info", "Promotion en production : initialisation...");

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true, config: true },
  });

  if (!project) {
    return { success: false, exitCode: 1, error: "Projet introuvable" };
  }

  const stagingStrategy =
    project.config?.deploymentStrategy === "staging_then_production";

  if (!stagingStrategy) {
    await ctx.log(
      "info",
      "Stratégie directe — étape de promotion ignorée",
    );
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "strategy direct" },
    };
  }

  if (!project.deploymentEnabled || !project.server) {
    await ctx.log("warn", "Déploiement désactivé ou serveur absent — promotion ignorée");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, reason: "deployment disabled" },
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

  const deployment = await prisma.deployment.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: {
      id: true,
      startedAt: true,
      stagingStatus: true,
      stagingUrl: true,
    },
  });

  if (!deployment) {
    return {
      success: false,
      exitCode: 1,
      error: "Aucun déploiement de staging trouvé",
    };
  }

  if (deployment.stagingStatus !== DeploymentStatus.SUCCESS) {
    return {
      success: false,
      exitCode: 1,
      error: "Le déploiement de staging n'a pas réussi — promotion refusée",
    };
  }

  const appPort = APP_PORT_BY_TECH[project.technology] ?? 80;
  const remoteDir = `/home/${server.username}/apps/${project.id}/production`;

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

  // Dernière image de production connue, pour le rollback.
  const previous = await prisma.deployment.findFirst({
    where: {
      projectId: ctx.projectId,
      environment: "PRODUCTION",
      status: DeploymentStatus.SUCCESS,
      pipelineId: { not: ctx.pipelineId },
      imageTag: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    select: { imageTag: true, url: true },
  });

  const ssh = new SshRunner();

  try {
    await ctx.log("info", "Connexion SSH pour la promotion...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });

    await stopLegacyDeployment(
      ssh,
      ctx,
      `/home/${server.username}/apps/${project.id}`,
    );

    let deployError: string | null = null;
    let productionUrl = `http://${server.host}:${PRODUCTION_PORT}`;

    try {
      const result = await deployCompose({
        ssh,
        ctx,
        remoteDir,
        imageTag: image.imageTag,
        appPort,
        externalPort: PRODUCTION_PORT,
        environment: "PRODUCTION",
        serverHost: server.host,
      });
      productionUrl = result.url;
      if (!result.healthy) {
        deployError = `Healthcheck production échoué (HTTP ${result.httpCode})`;
      }
    } catch (err) {
      deployError = err instanceof Error ? err.message : String(err);
    }

    const finishedAt = new Date();
    const durationMs = deployment.startedAt
      ? finishedAt.getTime() - deployment.startedAt.getTime()
      : null;

    if (!deployError) {
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.SUCCESS,
          environment: "PRODUCTION",
          productionUrl,
          productionStatus: DeploymentStatus.SUCCESS,
          url: productionUrl,
          finishedAt,
          durationMs,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: project.ownerId,
          action: "DEPLOYMENT_PROMOTED",
          targetType: "Deployment",
          targetId: deployment.id,
          metadataJson: {
            environment: "PRODUCTION",
            url: productionUrl,
            imageTag: image.imageTag,
            stagingUrl: deployment.stagingUrl,
          },
        },
      });

      await ctx.log("info", `Promotion réussie : ${productionUrl}`);

      return {
        success: true,
        exitCode: 0,
        data: {
          deploymentId: deployment.id,
          environment: "PRODUCTION",
          url: productionUrl,
          imageTag: image.imageTag,
        },
      };
    }

    // ----------------------------------------------------------
    // Échec de la production : rollback éventuel.
    // ----------------------------------------------------------
    await ctx.log("error", `Promotion échouée : ${deployError}`);

    const canRollback =
      project.config?.autoRollback !== false &&
      previous?.imageTag &&
      previous.imageTag !== image.imageTag;

    let rollbackImageTag: string | null = null;

    if (canRollback) {
      await ctx.log(
        "warn",
        `Tentative de rollback vers l'image ${previous.imageTag}...`,
      );
      try {
        const rollback = await deployCompose({
          ssh,
          ctx,
          remoteDir,
          imageTag: previous.imageTag!,
          appPort,
          externalPort: PRODUCTION_PORT,
          environment: "PRODUCTION",
          serverHost: server.host,
        });

        if (rollback.healthy) {
          rollbackImageTag = previous.imageTag!;
          await ctx.log(
            "info",
            `Rollback réussi : ${previous.imageTag} (${rollback.url})`,
          );
        } else {
          await ctx.log(
            "error",
            `Rollback déployé mais healthcheck en échec (HTTP ${rollback.httpCode})`,
          );
        }
      } catch (rollbackErr) {
        const msg =
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        await ctx.log("error", `Échec du rollback : ${msg}`);
      }
    } else {
      await ctx.log(
        "warn",
        "Rollback non disponible (autoRollback désactivé ou aucune image précédente)",
      );
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.FAILED,
        environment: "PRODUCTION",
        productionStatus: DeploymentStatus.FAILED,
        productionUrl,
        url: rollbackImageTag ? previous?.url ?? productionUrl : productionUrl,
        finishedAt,
        durationMs,
        error: deployError,
        rollbackImageTag,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: project.ownerId,
        action: rollbackImageTag
          ? "DEPLOYMENT_ROLLED_BACK"
          : "DEPLOYMENT_PROMOTION_FAILED",
        targetType: "Deployment",
        targetId: deployment.id,
        metadataJson: {
          error: deployError,
          rollbackImageTag,
          failedImageTag: image.imageTag,
        },
      },
    });

    return {
      success: false,
      exitCode: 1,
      error: rollbackImageTag
        ? `${deployError} — rollback vers ${rollbackImageTag}`
        : deployError,
    };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}
