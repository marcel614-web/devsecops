// apps/worker/src/steps/deployment/deployment.step.ts
import { DeploymentStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";
import {
  APP_PORT_BY_TECH,
  canRollbackToPrevious,
  deployCompose,
  stopLegacyDeployment,
} from "./deploy.helper";
import { resolveProjectPorts, type ProjectPorts } from "./ports";
import {
  acquireDeploymentLock,
  assertPipelineIsCurrent,
  releaseDeploymentLock,
} from "./deployment.lock";

/**
 * Étape de déploiement.
 *
 * - stratégie `direct` : déploie directement en production sur le port
 *   de production du projet (alloué automatiquement si nécessaire) ;
 * - stratégie `staging_then_production` : déploie d'abord sur le port
 *   de staging du projet. La promotion en production est faite par
 *   l'étape PROMOTE, après le DAST et le second Security Gate.
 *
 * Les ports sont uniques par serveur : plusieurs projets peuvent ainsi
 * être exposés simultanément sur la même VM.
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
        "Digest de l'image introuvable : l'artefact n'est pas traçable, déploiement refusé",
    };
  }

  const stagingStrategy =
    project.config?.deploymentStrategy === "staging_then_production";
  const environment: "STAGING" | "PRODUCTION" = stagingStrategy
    ? "STAGING"
    : "PRODUCTION";

  let ports: ProjectPorts;
  try {
    ports = await resolveProjectPorts(project.id, server.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Allocation des ports échouée : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  }

  const externalPort = stagingStrategy
    ? ports.stagingPort
    : ports.productionPort;

  const appPort = APP_PORT_BY_TECH[project.technology] ?? 80;
  const remoteDir = `/home/${server.username}/apps/${project.id}/${environment.toLowerCase()}`;

  await ctx.log(
    "info",
    `Serveur cible : ${server.name} (${server.host}:${server.sshPort})`,
  );
  await ctx.log("info", `Image à déployer : ${image.imageTag}`);
  await ctx.log("info", `Digest de l'artefact : ${image.imageDigest}`);
  await ctx.log(
    "info",
    `Environnement : ${environment} — port ${externalPort} (production ${ports.productionPort}, staging ${ports.stagingPort})`,
  );

  // Un pipeline plus récent sur la même branche rend cette exécution
  // obsolète : on refuse de remplacer la production avec un artefact dépassé.
  try {
    await assertPipelineIsCurrent(ctx.pipelineId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", msg);
    return { success: false, exitCode: 1, error: msg };
  }

  let lockAcquired = false;
  try {
    await acquireDeploymentLock(project.id, ctx.pipelineId, environment);
    lockAcquired = true;
    await ctx.log(
      "info",
      "Verrou de déploiement acquis — aucun autre pipeline ne peut déployer ce projet",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", msg);
    return { success: false, exitCode: 1, error: msg };
  }

  // `upsert` permet de reprendre un pipeline dont l'étape Deployment a
  // échoué : la contrainte unique sur pipelineId interdit de créer un
  // second enregistrement pour la même exécution.
  const previousProduction = stagingStrategy
    ? null
    : await prisma.deployment.findFirst({
        where: {
          projectId: ctx.projectId,
          environment: "PRODUCTION",
          status: DeploymentStatus.SUCCESS,
          pipelineId: { not: ctx.pipelineId },
        },
        orderBy: { finishedAt: "desc" },
        select: { id: true, imageTag: true, imageDigest: true, url: true },
      });

  const deploymentData = {
    pipelineId: ctx.pipelineId,
    projectId: ctx.projectId,
    serverId: server.id,
    status: DeploymentStatus.RUNNING,
    environment,
    startedAt: new Date(),
    imageTag: image.imageTag,
    imageDigest: image.imageDigest,
    previousDeploymentId: previousProduction?.id ?? null,
    releaseVersion: ctx.commitSha.slice(0, 12),
    stagingStatus: stagingStrategy ? DeploymentStatus.RUNNING : null,
    stagingUrl: null,
    url: null,
    productionUrl: null,
    productionStatus: null,
    rollbackImageTag: null,
    rollbackImageDigest: null,
    finishedAt: null,
    durationMs: null,
    error: null,
  };

  const deployment = await prisma.deployment.upsert({
    where: { pipelineId: ctx.pipelineId },
    create: deploymentData,
    update: deploymentData,
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
      hostKeyFingerprint: server.hostKeyFingerprint,
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
      expectedDigest: image.imageDigest,
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

    // En stratégie directe, la production vient d'être remplacée avant le
    // healthcheck. On tente de restaurer la dernière version vérifiée pour
    // ne pas laisser le service indisponible.
    let rollbackImageTag: string | null = null;
    let rollbackImageDigest: string | null = null;

    if (
      !stagingStrategy &&
      canRollbackToPrevious({
        autoRollback: project.config?.autoRollback,
        previousImageTag: previousProduction?.imageTag,
        previousImageDigest: previousProduction?.imageDigest,
        currentImageDigest: image.imageDigest,
      }) &&
      previousProduction?.imageTag
    ) {
      await ctx.log(
        "warn",
        `Tentative de rollback vers ${previousProduction.imageTag} ` +
          `(digest ${previousProduction.imageDigest})...`,
      );
      try {
        const rollback = await deployCompose({
          ssh,
          ctx,
          remoteDir,
          imageTag: previousProduction.imageTag,
          expectedDigest: previousProduction.imageDigest,
          appPort,
          externalPort,
          environment: "PRODUCTION",
          serverHost: server.host,
        });
        if (rollback.healthy) {
          rollbackImageTag = previousProduction.imageTag;
          rollbackImageDigest = rollback.imageDigest;
          await ctx.log(
            "info",
            `Rollback réussi vers ${previousProduction.imageTag}`,
          );
        } else {
          await ctx.log(
            "error",
            `Rollback déployé mais healthcheck en échec (HTTP ${rollback.httpCode})`,
          );
        }
      } catch (rollbackErr) {
        const rollbackMsg =
          rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr);
        await ctx.log("error", `Échec du rollback : ${rollbackMsg}`);
      }
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: DeploymentStatus.FAILED,
        finishedAt: new Date(),
        error: msg,
        url: rollbackImageTag
          ? previousProduction?.url ?? null
          : undefined,
        rollbackImageTag,
        rollbackImageDigest,
        ...(stagingStrategy
          ? { stagingStatus: DeploymentStatus.FAILED }
          : { productionStatus: DeploymentStatus.FAILED }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: project.ownerId,
        action: rollbackImageTag
          ? "DEPLOYMENT_ROLLED_BACK"
          : "DEPLOYMENT_FAILED",
        targetType: "Deployment",
        targetId: deployment.id,
        metadataJson: {
          error: msg,
          environment,
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
        ? `${msg} — rollback vers ${rollbackImageTag}`
        : msg,
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
