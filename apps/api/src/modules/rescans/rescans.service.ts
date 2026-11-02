// apps/api/src/modules/rescans/rescans.service.ts
import crypto from "node:crypto";
import {
  DeploymentStatus,
  Prisma,
  RescanStatus,
  Role,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import {
  enqueueRescanRun,
  rescanQueue,
} from "../../queues/rescan.queue";
import {
  resolveProjectHead,
  runPipeline,
} from "../pipelines/pipelines.service";
import type {
  RemediationInput,
  RescanListQuery,
} from "./rescans.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

const SUPPORTED_CONTROLS = new Set(["IMAGE"]);

async function ensureProjectAccess(
  actor: ActorContext,
  projectId: string,
): Promise<{ id: string; ownerId: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  if (actor.role === Role.ADMIN) return project;
  if (project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce projet");
  }
  return project;
}

function supportedControls(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()))].filter(
    (value) => SUPPORTED_CONTROLS.has(value),
  );
}

async function latestDigestDeployment(projectId: string) {
  return prisma.deployment.findFirst({
    where: {
      projectId,
      environment: "PRODUCTION",
      status: DeploymentStatus.SUCCESS,
      imageDigest: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    select: {
      id: true,
      pipelineId: true,
      serverId: true,
      imageTag: true,
      imageDigest: true,
      environment: true,
      pipeline: { select: { commitSha: true, branch: true } },
    },
  });
}

export async function listRescans(
  actor: ActorContext,
  projectId: string,
  query: RescanListQuery,
) {
  await ensureProjectAccess(actor, projectId);
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.rescanRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      select: {
        id: true,
        projectId: true,
        deploymentId: true,
        pipelineId: true,
        environment: true,
        commitSha: true,
        branch: true,
        imageTag: true,
        imageDigest: true,
        trigger: true,
        status: true,
        controls: true,
        timeoutMs: true,
        error: true,
        summaryJson: true,
        comparisonJson: true,
        queuedAt: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        createdAt: true,
        scans: {
          select: {
            id: true,
            scanner: true,
            scannerVersion: true,
            status: true,
            outcome: true,
            criticalCount: true,
            highCount: true,
            mediumCount: true,
            lowCount: true,
            infoCount: true,
          },
        },
      },
    }),
    prisma.rescanRun.count({ where: { projectId } }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getRescan(
  actor: ActorContext,
  projectId: string,
  runId: string,
) {
  await ensureProjectAccess(actor, projectId);
  const run = await prisma.rescanRun.findFirst({
    where: { id: runId, projectId },
    include: {
      server: {
        select: { id: true, name: true, host: true },
      },
      deployment: {
        select: {
          id: true,
          environment: true,
          imageTag: true,
          imageDigest: true,
          finishedAt: true,
        },
      },
      pipeline: {
        select: {
          id: true,
          commitSha: true,
          branch: true,
          status: true,
          createdAt: true,
        },
      },
      scans: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          scanner: true,
          scannerVersion: true,
          type: true,
          status: true,
          outcome: true,
          criticalCount: true,
          highCount: true,
          mediumCount: true,
          lowCount: true,
          infoCount: true,
          durationMs: true,
          exitCode: true,
          startedAt: true,
          finishedAt: true,
        },
      },
    },
  });
  if (!run) throw new NotFoundError("Rescan introuvable");
  return run;
}

/**
 * Déclenchement manuel. Le job reste unique par run (`jobId`), et un rescan
 * déjà actif sur le projet est refusé : deux clics ne créent pas deux scans
 * concurrents du même artefact.
 */
export async function triggerRescan(
  actor: ActorContext,
  projectId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId },
  });
  if (!config) throw new NotFoundError("Configuration du projet introuvable");
  if (!config.rescanEnabled) {
    throw new ConflictError(
      "Le rescan périodique est désactivé pour ce projet. Activez-le avant de lancer une réévaluation.",
    );
  }

  const controls = supportedControls(config.rescanControls);
  if (controls.length === 0) {
    throw new ConflictError(
      "Aucun contrôle de rescan supporté n'est configuré (contrôle IMAGE requis).",
    );
  }

  const active = await prisma.rescanRun.findFirst({
    where: {
      projectId,
      status: { in: [RescanStatus.QUEUED, RescanStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (active) {
    throw new ConflictError(
      "Un rescan est déjà en file ou en cours pour ce projet.",
    );
  }

  const deployment = await latestDigestDeployment(projectId);
  if (
    !deployment?.imageDigest ||
    !deployment.pipeline ||
    !deployment.serverId
  ) {
    throw new ConflictError(
      "Aucun déploiement de production réussi avec digest vérifiable n'est disponible. " +
        "Le rescan ne peut pas réévaluer une version non déployée.",
    );
  }

  const run = await prisma.rescanRun.create({
    data: {
      projectId,
      deploymentId: deployment.id,
      pipelineId: deployment.pipelineId,
      serverId: deployment.serverId,
      environment: "PRODUCTION",
      commitSha: deployment.pipeline.commitSha,
      branch: deployment.pipeline.branch,
      imageTag: deployment.imageTag,
      imageDigest: deployment.imageDigest,
      cycleKey: `manual:${Date.now()}:${crypto.randomUUID()}`,
      trigger: "MANUAL",
      controls,
      timeoutMs: Math.min(
        60 * 60_000,
        Math.max(30_000, config.rescanTimeoutMs),
      ),
    },
  });

  try {
    await enqueueRescanRun(run.id);
  } catch (err) {
    await prisma.rescanRun.update({
      where: { id: run.id },
      data: {
        status: RescanStatus.FAILED,
        finishedAt: new Date(),
        error: "File d'attente indisponible : rescan non exécuté",
      },
    });
    throw new ConflictError(
      `Impossible de mettre le rescan en file : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "RESCAN_TRIGGERED",
      targetType: "RescanRun",
      targetId: run.id,
      metadataJson: {
        projectId,
        deploymentId: deployment.id,
        imageDigest: deployment.imageDigest,
        controls,
      },
    },
  });

  return run;
}

export async function cancelRescan(
  actor: ActorContext,
  projectId: string,
  runId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const run = await prisma.rescanRun.findFirst({
    where: { id: runId, projectId },
    select: { id: true, status: true },
  });
  if (!run) throw new NotFoundError("Rescan introuvable");
  if (
    run.status !== RescanStatus.QUEUED &&
    run.status !== RescanStatus.RUNNING
  ) {
    throw new ConflictError("Ce rescan n'est plus annulable");
  }

  try {
    const job = await rescanQueue.getJob(`rescan:${run.id}`);
    if (job) {
      const state = await job.getState();
      if (state === "waiting" || state === "delayed" || state === "prioritized") {
        await job.remove();
      }
    }
  } catch {
    // Le job peut être actif : le worker vérifiera l'annulation avant de
    // persister le résultat.
  }

  const updated = await prisma.rescanRun.updateMany({
    where: {
      id: run.id,
      status: { in: [RescanStatus.QUEUED, RescanStatus.RUNNING] },
    },
    data: {
      status: RescanStatus.CANCELLED,
      finishedAt: new Date(),
      error: `Rescan annulé par ${actor.id}`,
    },
  });
  if (updated.count === 0) {
    throw new ConflictError("Ce rescan s'est terminé avant l'annulation");
  }

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "RESCAN_CANCELLED",
      targetType: "RescanRun",
      targetId: run.id,
      metadataJson: { projectId, previousStatus: run.status },
    },
  });

  return prisma.rescanRun.findUniqueOrThrow({ where: { id: run.id } });
}

/**
 * Remédiation explicite : crée un pipeline sur un NOUVEAU commit HEAD.
 * Aucun déploiement n'est déclenché par le rescan lui-même ; la politique
 * `rescanRemediationEnabled` doit être activée et le commit doit avoir changé.
 */
export async function createRemediationPipeline(
  actor: ActorContext,
  projectId: string,
  runId: string,
  input: RemediationInput,
) {
  await ensureProjectAccess(actor, projectId);

  const [config, run] = await Promise.all([
    prisma.projectConfiguration.findUnique({
      where: { projectId },
      select: { rescanRemediationEnabled: true },
    }),
    prisma.rescanRun.findFirst({
      where: { id: runId, projectId },
      select: {
        id: true,
        status: true,
        commitSha: true,
        branch: true,
        summaryJson: true,
      },
    }),
  ]);
  if (!config?.rescanRemediationEnabled) {
    throw new ForbiddenError(
      "La remédiation automatique est désactivée : activez explicitement la politique de remédiation du rescan.",
    );
  }
  if (!run) throw new NotFoundError("Rescan introuvable");
  if (run.status !== RescanStatus.SUCCESS) {
    throw new ConflictError(
      "La remédiation nécessite un rescan terminé avec succès",
    );
  }

  const summary = run.summaryJson as
    | { riskFound?: boolean }
    | null
    | undefined;
  if (!summary?.riskFound) {
    throw new ConflictError(
      "Aucun risque nouveau ou aggravé n'a été identifié par ce rescan",
    );
  }

  const head = await resolveProjectHead(projectId, run.branch);
  if (!head) {
    throw new ConflictError(
      "Impossible de résoudre un commit complet pour la remédiation",
    );
  }
  if (head.sha === run.commitSha) {
    throw new ConflictError(
      "Le HEAD est identique à la version analysée : créez un commit de correction avant de relancer la remédiation.",
    );
  }

  const pipeline = await runPipeline(actor, projectId, {
    commitSha: head.sha,
    branch: head.branch,
    author: head.author,
    trigger: "rescan-remediation",
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "RESCAN_REMEDIATION_REQUESTED",
      targetType: "RescanRun",
      targetId: run.id,
      metadataJson: {
        projectId,
        pipelineId: pipeline.id,
        previousCommitSha: run.commitSha,
        remediationCommitSha: head.sha,
        reason:
          input.reason ?? "Remédiation explicite depuis l'historique de rescan",
      } satisfies Prisma.InputJsonObject,
    },
  });

  return pipeline;
}
