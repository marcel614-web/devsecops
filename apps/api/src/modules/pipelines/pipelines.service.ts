// apps/api/src/modules/pipelines/pipelines.service.ts
import fs from "node:fs/promises";
import { PipelineStatus, Prisma, Role, StepStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { pipelineQueue } from "../../queues/pipeline.queue";
import { redisConnection } from "../../queues/connection";
import { buildDefaultSteps } from "./pipeline.steps";
import type {
  PipelineListQuery,
  PipelineLogsQuery,
  PipelineScansQuery,
  RunPipelineInput,
  VulnerabilityListQuery,
} from "./pipelines.schema";

// Clé Redis partagée avec le worker. Doit correspondre à
// PIPELINE_CANCEL_PREFIX dans apps/worker/src/utils/cancellation.ts
const PIPELINE_CANCEL_PREFIX = "pipeline:cancel:";
const PIPELINE_CANCEL_TTL_SEC = 3600; // 1 h

export interface ActorContext {
  id: string;
  role: Role;
}

// ============================================================
// HELPERS
// ============================================================

async function ensureProjectAccess(
  actor: ActorContext,
  projectId: string,
): Promise<{ id: string; ownerId: string; defaultBranch: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, defaultBranch: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");

  if (actor.role === Role.ADMIN) return project;
  if (project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce projet");
  }
  return project;
}

// ============================================================
// LIST
// ============================================================

export async function listPipelines(
  actor: ActorContext,
  projectId: string,
  query: PipelineListQuery,
) {
  await ensureProjectAccess(actor, projectId);

  const where: Prisma.PipelineWhereInput = { projectId };
  if (query.status) where.status = query.status;
  if (query.branch) where.branch = query.branch;

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.pipeline.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      select: {
        id: true,
        commitSha: true,
        branch: true,
        author: true,
        trigger: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        createdAt: true,
        _count: { select: { steps: true, scans: true } },
      },
    }),
    prisma.pipeline.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

// ============================================================
// DETAIL
// ============================================================

export async function getPipeline(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    include: {
      steps: { orderBy: { order: "asc" } },
      gateResult: true,
      deployment: true,
      dockerImage: true,
      sbom: true,
      _count: { select: { logs: true, scans: true } },
    },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");
  return pipeline;
}

// ============================================================
// RUN
// ============================================================

export async function runPipeline(
  actor: ActorContext,
  projectId: string,
  input: RunPipelineInput,
) {
  const project = await ensureProjectAccess(actor, projectId);

  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId },
  });
  if (!config) throw new NotFoundError("Configuration du projet introuvable");

  const branch = input.branch ?? project.defaultBranch;
  const commitSha = input.commitSha ?? `manual-${Date.now()}`;
  const author = input.author ?? actor.id;
  const trigger = input.trigger ?? "manual";

  const pipeline = await prisma.$transaction(async (tx) => {
    const created = await tx.pipeline.create({
      data: {
        projectId,
        commitSha,
        branch,
        author,
        trigger,
        status: PipelineStatus.QUEUED,
      },
      select: {
        id: true,
        projectId: true,
        commitSha: true,
        branch: true,
        author: true,
        trigger: true,
        status: true,
        createdAt: true,
      },
    });

    const stepDefs = buildDefaultSteps(config);

    await tx.pipelineStep.createMany({
      data: stepDefs.map((s) => ({
        pipelineId: created.id,
        name: s.name,
        type: s.type,
        order: s.order,
        status: StepStatus.QUEUED,
        resultJson: { critical: s.critical } as Prisma.InputJsonValue,
      })),
    });

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "PIPELINE_TRIGGERED",
        targetType: "Pipeline",
        targetId: created.id,
        metadataJson: { projectId, branch, commitSha, trigger },
      },
    });

    return created;
  });

  // Nettoyage préventif d'un éventuel flag d'annulation obsolète
  await redisConnection.del(`${PIPELINE_CANCEL_PREFIX}${pipeline.id}`);

  await pipelineQueue.add(
    "run",
    { pipelineId: pipeline.id },
    { jobId: pipeline.id },
  );

  return pipeline;
}

// ============================================================
// CANCEL
// ============================================================

export async function cancelPipeline(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    select: { id: true, status: true },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");

  if (
    pipeline.status !== PipelineStatus.QUEUED &&
    pipeline.status !== PipelineStatus.RUNNING
  ) {
    throw new ConflictError("Ce pipeline ne peut plus être annulé");
  }

  // ----------------------------------------------------------
  // 1. Signal Redis : le worker lira ce flag entre chaque étape
  //    et s'arrêtera dès qu'il sera posé.
  // ----------------------------------------------------------
  await redisConnection.set(
    `${PIPELINE_CANCEL_PREFIX}${pipelineId}`,
    "1",
    "EX",
    PIPELINE_CANCEL_TTL_SEC,
  );

  // ----------------------------------------------------------
  // 2. Marque le pipeline comme CANCELLED immédiatement.
  //    Le worker ne réécrira pas ce statut (voir pipeline.engine).
  // ----------------------------------------------------------
  const now = new Date();
  const durationMs = pipeline.status === PipelineStatus.RUNNING
    ? undefined
    : 0;

  await prisma.pipeline.update({
    where: { id: pipelineId },
    data: {
      status: PipelineStatus.CANCELLED,
      finishedAt: now,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  });

  // ----------------------------------------------------------
  // 3. Marque toutes les étapes encore QUEUED comme CANCELLED.
  //    Les étapes RUNNING termineront naturellement (le worker
  //    ne peut pas interrompre un sous-processus en cours).
  // ----------------------------------------------------------
  await prisma.pipelineStep.updateMany({
    where: {
      pipelineId,
      status: StepStatus.QUEUED,
    },
    data: {
      status: StepStatus.CANCELLED,
      finishedAt: now,
      error: "Annulé par l'utilisateur",
    },
  });

  // ----------------------------------------------------------
  // 4. Retire le job BullMQ s'il est encore en attente.
  //    Si le job est déjà "active" (worker en cours), on ne
  //    peut pas le retirer : c'est le flag Redis qui fera foi.
  // ----------------------------------------------------------
  try {
    const job = await pipelineQueue.getJob(pipelineId);
    if (job) {
      const state = await job.getState();
if (
  state === "waiting" ||
  state === "delayed" ||
  state === "prioritized" ||
  state === "waiting-children"
) {
  await job.remove();
}
    }
  } catch {
    // On ignore : le flag Redis suffit.
  }

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PIPELINE_CANCELLED",
      targetType: "Pipeline",
      targetId: pipelineId,
      metadataJson: {
        previousStatus: pipeline.status,
      },
    },
  });
}

// ============================================================
// LOGS
// ============================================================

export async function getPipelineLogs(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
  query: PipelineLogsQuery,
) {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    select: { id: true },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");

  const where: Prisma.PipelineLogWhereInput = { pipelineId };
  if (query.stepId) where.stepId = query.stepId;
  if (query.level) where.level = query.level;

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.pipelineLog.findMany({
      where,
      orderBy: { sequence: "asc" },
      skip,
      take: query.pageSize,
      select: {
        id: true,
        pipelineId: true,
        stepId: true,
        level: true,
        message: true,
        sequence: true,
        createdAt: true,
        step: {
          select: { id: true, name: true, type: true, order: true },
        },
      },
    }),
    prisma.pipelineLog.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

// ============================================================
// SCANS
// ============================================================

export async function getPipelineScans(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
  query: PipelineScansQuery,
) {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    select: { id: true },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");

  const where: Prisma.SecurityScanWhereInput = { pipelineId };
  if (query.type) where.type = query.type;

  const scans = await prisma.securityScan.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      scanner: true,
      type: true,
      status: true,
      criticalCount: true,
      highCount: true,
      mediumCount: true,
      lowCount: true,
      infoCount: true,
      durationMs: true,
      exitCode: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      _count: { select: { vulnerabilities: true } },
    },
  });

  return { scans };
}

// ============================================================
// REPORT
// ============================================================

export async function getPipelineReport(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    select: { id: true },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");

  const report = await prisma.securityReport.findUnique({
    where: { pipelineId },
    select: {
      id: true,
      pipelineId: true,
      projectId: true,
      summaryJson: true,
      htmlPath: true,
      pdfPath: true,
      createdAt: true,
    },
  });

  if (!report) {
    throw new NotFoundError(
      "Aucun rapport disponible pour ce pipeline (l'étape Final Report n'a pas encore tourné)",
    );
  }

  return { report };
}

/**
 * Lit le fichier HTML ou PDF d'un rapport et renvoie son contenu.
 * Les fichiers sont générés par le worker dans REPORTS_DIR.
 */
export async function getPipelineReportFile(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
  format: "html" | "pdf",
) {
  await ensureProjectAccess(actor, projectId);

  const report = await prisma.securityReport.findUnique({
    where: { pipelineId },
    select: { htmlPath: true, pdfPath: true },
  });
  if (!report) {
    throw new NotFoundError("Aucun rapport disponible pour ce pipeline");
  }

  const filePath = format === "html" ? report.htmlPath : report.pdfPath;
  if (!filePath) {
    throw new NotFoundError(`Rapport ${format.toUpperCase()} non généré`);
  }

  let content: Buffer;
  try {
    content = await fs.readFile(filePath);
  } catch {
    throw new NotFoundError(
      `Fichier de rapport ${format.toUpperCase()} introuvable sur le disque`,
    );
  }

  return {
    content,
    filename: `rapport-${pipelineId}.${format}`,
    contentType:
      format === "html" ? "text/html; charset=utf-8" : "application/pdf",
  };
}

// ============================================================
// VULNÉRABILITÉS D'UN PROJET
// ============================================================

export async function listProjectVulnerabilities(
  actor: ActorContext,
  projectId: string,
  query: VulnerabilityListQuery,
) {
  await ensureProjectAccess(actor, projectId);

  const where: Prisma.VulnerabilityWhereInput = {
    scan: { projectId },
  };
  if (query.severity) where.severity = query.severity;
  if (query.tool) where.tool = query.tool;
  if (query.pipelineId) {
    where.scan = { projectId, pipelineId: query.pipelineId };
  }
  if (query.search) {
    where.OR = [
      { packageName: { contains: query.search, mode: "insensitive" } },
      { filePath: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
      { reference: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.vulnerability.findMany({
      where,
      orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
      skip,
      take: query.pageSize,
      select: {
        id: true,
        tool: true,
        technology: true,
        severity: true,
        packageName: true,
        filePath: true,
        version: true,
        fixedVersion: true,
        description: true,
        reference: true,
        detectedAt: true,
        scan: {
          select: {
            id: true,
            scanner: true,
            type: true,
            pipelineId: true,
          },
        },
      },
    }),
    prisma.vulnerability.count({ where }),
  ]);

  const grouped = await prisma.vulnerability.groupBy({
    by: ["severity"],
    where: { scan: { projectId } },
    _count: { _all: true },
  });

  const severityCounts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const g of grouped) {
    severityCounts[g.severity] = g._count._all;
  }

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
    severityCounts,
  };
}

// ============================================================
// DELETE
// ============================================================
export async function deletePipeline(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    select: { id: true, status: true },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");

  if (pipeline.status === PipelineStatus.RUNNING) {
    throw new ConflictError("Pipeline en cours � annulez-le avant de le supprimer");
  }

  if (pipeline.status === PipelineStatus.QUEUED) {
    await cancelPipeline(actor, projectId, pipelineId);
  }

  await prisma.pipeline.delete({ where: { id: pipelineId } });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PIPELINE_DELETED",
      targetType: "Pipeline",
      targetId: pipelineId,
      metadataJson: {
        previousStatus: pipeline.status,
      },
    },
  });
}


// ============================================================
// DOWNLOAD LOGS
// ============================================================
export async function downloadPipelineLogs(
  actor: ActorContext,
  projectId: string,
  pipelineId: string,
): Promise<string> {
  await ensureProjectAccess(actor, projectId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, projectId },
    select: { id: true },
  });
  if (!pipeline) throw new NotFoundError("Pipeline introuvable");

  const logs = await prisma.pipelineLog.findMany({
    where: { pipelineId },
    orderBy: { sequence: "asc" },
    select: { sequence: true, level: true, message: true, createdAt: true, step: { select: { name: true } } },
  });

  const lines = logs.map((l) => {
    const ts = l.createdAt.toISOString();
    const step = l.step?.name ? ` [${l.step.name}]` : "";
    return `${ts} [${l.level.toUpperCase()}]${step} ${l.message}`;
  });

  return lines.join("\n");
}
