// apps/api/src/modules/pipelines/pipelines.service.ts
import { PipelineStatus, Prisma, Role, StepStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { pipelineQueue } from "../../queues/pipeline.queue";
import type {
  PipelineListQuery,
  PipelineLogsQuery,
  PipelineScansQuery,
  RunPipelineInput,
  VulnerabilityListQuery,
} from "./pipelines.schema";

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

interface StepDef {
  name: string;
  type: string;
  order: number;
  critical: boolean;
}

function buildDefaultSteps(config: {
  gitleaksEnabled: boolean;
  semgrepEnabled: boolean;
  scaEnabled: boolean;
  trivyEnabled: boolean;
  zapEnabled: boolean;
}): StepDef[] {
  const steps: StepDef[] = [
    { name: "Checkout",             type: "CHECKOUT",     order: 1, critical: true  },
    { name: "Technology Detection", type: "DETECTION",    order: 2, critical: true  },
    { name: "Install Dependencies", type: "INSTALL_DEPS", order: 3, critical: true  },
    // Tests non critique : on veut quand même lancer les scanners de sécurité,
    // même si les tests échouent. Le Security Gate décidera du blocage final.
    { name: "Tests",                type: "TESTS",        order: 4, critical: false },
  ];

  let order = 5;

  if (config.gitleaksEnabled) {
    steps.push({ name: "Gitleaks", type: "SECRET_SCAN", order: order++, critical: false });
  }
  if (config.semgrepEnabled) {
    steps.push({ name: "Semgrep", type: "SAST", order: order++, critical: false });
  }
  if (config.scaEnabled) {
    steps.push({ name: "SCA", type: "SCA", order: order++, critical: false });
  }

  steps.push({ name: "Docker Build", type: "DOCKER_BUILD", order: order++, critical: true });
  steps.push({ name: "Trivy", type: "IMAGE_SCAN", order: order++, critical: false });
  steps.push({ name: "Security Gate", type: "SECURITY_GATE", order: order++, critical: true });

  steps.push({ name: "Deployment", type: "DEPLOYMENT", order: order++, critical: false });

  if (config.zapEnabled) {
    steps.push({ name: "OWASP ZAP", type: "DAST", order: order++, critical: false });
  }

  steps.push({ name: "Final Report", type: "REPORT", order: order++, critical: false });

  return steps;
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

  await prisma.pipeline.update({
    where: { id: pipelineId },
    data: {
      status: PipelineStatus.CANCELLED,
      finishedAt: new Date(),
    },
  });

  const job = await pipelineQueue.getJob(pipelineId);
  if (job) {
    await job.remove().catch(() => undefined);
  }

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "PIPELINE_CANCELLED",
      targetType: "Pipeline",
      targetId: pipelineId,
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