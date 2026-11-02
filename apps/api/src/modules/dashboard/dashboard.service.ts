// apps/api/src/modules/dashboard/dashboard.service.ts
import { Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";

export interface ActorContext {
  id: string;
  role: Role;
}

export async function getDashboardSummary(actor: ActorContext) {
  const isAdmin = actor.role === Role.ADMIN;

  // Filtres de portée : DEVELOPER = ses projets uniquement, ADMIN = tout.
  const projectFilter = isAdmin ? {} : { ownerId: actor.id };
  const pipelineFilter = isAdmin
    ? {}
    : { project: { ownerId: actor.id } };
  const scanFilter = isAdmin
    ? {}
    : { project: { ownerId: actor.id } };
  const vulnFilter = isAdmin
    ? {}
    : { scan: { project: { ownerId: actor.id } } };
  const serverFilter = isAdmin ? {} : { ownerId: actor.id };

  // 1. Compteurs globaux en parallèle.
  const [
    totalProjects,
    totalServers,
    totalPipelines,
    totalScans,
    totalVulnerabilities,
  ] = await Promise.all([
    prisma.project.count({ where: projectFilter }),
    prisma.deploymentServer.count({ where: serverFilter }),
    prisma.pipeline.count({ where: pipelineFilter }),
    prisma.securityScan.count({ where: scanFilter }),
    prisma.vulnerability.count({ where: vulnFilter }),
  ]);

  // 2. Pipelines par statut.
  const pipelineStatusGroups = await prisma.pipeline.groupBy({
    by: ["status"],
    where: pipelineFilter,
    _count: { _all: true },
  });

  const pipelinesByStatus = {
    QUEUED: 0,
    RUNNING: 0,
    SUCCESS: 0,
    SUCCESS_WITH_WARNINGS: 0,
    FAILED: 0,
    SECURITY_BLOCKED: 0,
    CANCELLED: 0,
    TIMED_OUT: 0,
    WAITING_APPROVAL: 0,
  };
  for (const g of pipelineStatusGroups) {
    pipelinesByStatus[g.status] = g._count._all;
  }

  // 3. Vulnérabilités par sévérité.
  const vulnSeverityGroups = await prisma.vulnerability.groupBy({
    by: ["severity"],
    where: vulnFilter,
    _count: { _all: true },
  });

  const vulnerabilitiesBySeverity = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const g of vulnSeverityGroups) {
    vulnerabilitiesBySeverity[g.severity] = g._count._all;
  }

  // 4. Derniers pipelines (10 les plus récents).
  const recentPipelines = await prisma.pipeline.findMany({
    where: pipelineFilter,
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      projectId: true,
      commitSha: true,
      branch: true,
      author: true,
      trigger: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      createdAt: true,
      project: {
        select: { id: true, name: true, repoFullName: true },
      },
      _count: { select: { scans: true } },
    },
  });

  // 5. Dernières vulnérabilités critiques/high (5 plus récentes).
  const topVulnerabilities = await prisma.vulnerability.findMany({
    where: {
      ...vulnFilter,
      severity: { in: ["CRITICAL", "HIGH"] },
    },
    orderBy: { detectedAt: "desc" },
    take: 5,
    select: {
      id: true,
      tool: true,
      severity: true,
      packageName: true,
      description: true,
      detectedAt: true,
      scan: {
        select: {
          pipelineId: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
  });

  return {
    summary: {
      totalProjects,
      totalServers,
      totalPipelines,
      totalScans,
      totalVulnerabilities,
    },
    pipelinesByStatus,
    vulnerabilitiesBySeverity,
    recentPipelines,
    topVulnerabilities,
  };
}