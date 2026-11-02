// apps/worker/src/steps/deployment/promotion.step.ts
import { DeploymentApprovalStatus, DeploymentStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  APP_PORT_BY_TECH,
  canRollbackToPrevious,
  deployCompose,
  isStagingReadyForPromotion,
  stopLegacyDeployment,
} from "./deploy.helper";
import { resolveProjectPorts, type ProjectPorts } from "./ports";
import {
  acquireDeploymentLock,
  assertPipelineIsCurrent,
  releaseDeploymentLock,
} from "./deployment.lock";

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
    select: { imageTag: true, imageDigest: true },
  });
  if (!image) {
    return {
      success: false,
      exitCode: 1,
      error: "Aucune image Docker trouvée pour ce pipeline",
    };
  }
  if (!image.imageDigest) {
    return {
      success: false,
      exitCode: 1,
      error:
        "Digest de l'image introuvable : promotion refusée (artefact non traçable)",
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

  if (!isStagingReadyForPromotion(deployment.stagingStatus)) {
    return {
      success: false,
      exitCode: 1,
      error: "Le déploiement de staging n'a pas réussi — promotion refusée",
    };
  }

  // Défense en profondeur : même si l'étape APPROVAL a été contournée ou si
  // la décision a été révoquée entre-temps, la promotion vérifie elle-même
  // que l'approbation porte sur ce commit et ce digest, et qu'elle est encore
  // valide. Une approbation n'est jamais réutilisable pour un autre artefact.
  if (project.config?.requireProductionApproval) {
    const approval = await prisma.deploymentApproval.findUnique({
      where: { pipelineId: ctx.pipelineId },
    });
    const now = new Date();
    const valid =
      approval?.status === DeploymentApprovalStatus.APPROVED &&
      approval.commitSha === ctx.commitSha &&
      approval.imageDigest === image.imageDigest &&
      (!approval.expiresAt || approval.expiresAt > now);

    if (!valid) {
      return {
        success: false,
        exitCode: 1,
        error:
          "Promotion refusée : aucune approbation valide pour ce commit et ce digest",
      };
    }

    await ctx.log(
      "info",
      `Approbation valide (${approval.id}) — décidée le ` +
        `${approval.decidedAt?.toISOString() ?? "date inconnue"} par ` +
        `${approval.decidedById ?? "utilisateur inconnu"}`,
    );
  }

  const appPort = APP_PORT_BY_TECH[project.technology] ?? 80;
  const remoteDir = `/home/${server.username}/apps/${project.id}/production`;

  let ports: ProjectPorts;
  try {
    ports = await resolveProjectPorts(project.id, server.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Allocation des ports échouée : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  }
  const productionPort = ports.productionPort;

  await ctx.log(
    "info",
    `Port de production alloué : ${productionPort} (staging ${ports.stagingPort})`,
  );

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
    select: { id: true, imageTag: true, imageDigest: true, url: true },
  });

  // Un pipeline plus récent sur la même branche rend cette promotion
  // obsolète : on ne remplace pas la production avec un artefact dépassé.
  try {
    await assertPipelineIsCurrent(ctx.pipelineId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", msg);
    return { success: false, exitCode: 1, error: msg };
  }

  let lockAcquired = false;
  try {
    await acquireDeploymentLock(
      project.id,
      ctx.pipelineId,
      "PRODUCTION_PROMOTION",
    );
    lockAcquired = true;
    await ctx.log(
      "info",
      "Verrou de production acquis — promotion exclusive",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", msg);
    return { success: false, exitCode: 1, error: msg };
  }

  const ssh = new SshRunner();

  try {
    await ctx.log("info", "Connexion SSH pour la promotion...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });

    await stopLegacyDeployment(
      ssh,
      ctx,
      `/home/${server.username}/apps/${project.id}`,
    );

    let deployError: string | null = null;
    let productionUrl = `http://${server.host}:${productionPort}`;

    try {
      const result = await deployCompose({
        ssh,
        ctx,
        remoteDir,
        imageTag: image.imageTag,
        expectedDigest: image.imageDigest,
        appPort,
        externalPort: productionPort,
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
          imageDigest: image.imageDigest,
          previousDeploymentId: previous?.id ?? null,
          finishedAt,
          durationMs,
          // Une promotion qui reussit ne doit pas conserver l'erreur d'une
          // tentative precedente (reprise de pipeline apres timeout SSH).
          error: null,
          rollbackImageTag: null,
          rollbackImageDigest: null,
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

    const canRollback = canRollbackToPrevious({
      autoRollback: project.config?.autoRollback,
      previousImageTag: previous?.imageTag,
      previousImageDigest: previous?.imageDigest,
      currentImageDigest: image.imageDigest,
    });

    let rollbackImageTag: string | null = null;
    let rollbackImageDigest: string | null = null;

    if (canRollback && previous) {
      await ctx.log(
        "warn",
        `Tentative de rollback vers l'image ${previous.imageTag} ` +
          `(digest ${previous.imageDigest})...`,
      );
      try {
        const rollback = await deployCompose({
          ssh,
          ctx,
          remoteDir,
          imageTag: previous.imageTag!,
          expectedDigest: previous.imageDigest,
          appPort,
          externalPort: productionPort,
          environment: "PRODUCTION",
          serverHost: server.host,
        });

        if (rollback.healthy) {
          rollbackImageTag = previous.imageTag!;
          rollbackImageDigest = rollback.imageDigest;
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
        rollbackImageDigest,
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
          rollbackImageDigest,
          failedImageTag: image.imageTag,
          failedImageDigest: image.imageDigest,
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
    if (lockAcquired) {
      await releaseDeploymentLock(ctx.projectId, ctx.pipelineId).catch(
        () => undefined,
      );
    }
  }
}
