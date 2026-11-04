// apps/api/src/modules/vulnerabilities/vulnerabilities.service.ts
import {
  Prisma,
  Role,
  Severity,
  SpecialPermission,
  VulnerabilityStatus,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import {
  hasSpecialPermission,
  requirePermission,
} from "../authorization/permission.service";
import {
  PERMISSIONS,
  type PermissionValue,
} from "../authorization/permissions.constants";
import type {
  UpdateVulnerabilityInput,
  VulnerabilityListQuery,
} from "./vulnerabilities.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

async function ensureProjectAccess(
  actor: ActorContext,
  projectId: string,
  required: PermissionValue = PERMISSIONS.VULNERABILITY_READ,
): Promise<void> {
  await requirePermission(actor, required, {
    projectId,
    targetType: "Project",
    targetId: projectId,
  });
}

// ============================================================
// TYPES
// ============================================================

interface ScanRef {
  id: string;
  scanner: string;
  type: string;
  pipelineId: string;
  createdAt: Date;
  pipeline: { commitSha: string; branch: string; status: string } | null;
}

interface GroupedVulnerability {
  id: string;
  fingerprint: string | null;
  tool: string;
  technology: string | null;
  severity: Severity;
  packageName: string | null;
  filePath: string | null;
  version: string | null;
  fixedVersion: string | null;
  description: string | null;
  reference: string | null;
  status: VulnerabilityStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  detectedAt: Date;
  occurrences: number;
  assignedTo: { id: string; name: string; email: string } | null;
  notes: string | null;
  dueDate: Date | null;
  scan: ScanRef | null;
  scans: ScanRef[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

/**
 * Statuts qui ne représentent plus un risque à traiter. `RISK_ACCEPTED`
 * reste compté : le risque existe toujours, il est simplement accepté.
 */
const INACTIVE_STATUSES = new Set<VulnerabilityStatus>([
  VulnerabilityStatus.FIXED,
  VulnerabilityStatus.FALSE_POSITIVE,
  VulnerabilityStatus.DUPLICATE,
]);

function isActiveStatus(status: VulnerabilityStatus): boolean {
  return !INACTIVE_STATUSES.has(status);
}

const SELECT = {
  id: true,
  fingerprint: true,
  tool: true,
  technology: true,
  severity: true,
  packageName: true,
  filePath: true,
  version: true,
  fixedVersion: true,
  description: true,
  reference: true,
  status: true,
  firstSeenAt: true,
  lastSeenAt: true,
  notes: true,
  dueDate: true,
  assignedTo: {
    select: { id: true, name: true, email: true },
  },
  scan: {
    select: {
      id: true,
      scanner: true,
      type: true,
      pipelineId: true,
      createdAt: true,
      pipeline: {
        select: { commitSha: true, branch: true, status: true },
      },
    },
  },
} satisfies Prisma.VulnerabilitySelect;

type Row = Prisma.VulnerabilityGetPayload<{ select: typeof SELECT }>;

// ============================================================
// CHARGEMENT + DÉDUPLICATION
// ============================================================

function buildWhere(
  projectId: string,
  query?: Partial<VulnerabilityListQuery>,
): Prisma.VulnerabilityWhereInput {
  const scan: Prisma.SecurityScanWhereInput = { projectId };
  if (query?.pipelineId) scan.pipelineId = query.pipelineId;
  if (query?.scanType) scan.type = query.scanType;

  const where: Prisma.VulnerabilityWhereInput = { scan };

  if (query?.severity) where.severity = query.severity;
  if (query?.status) where.status = query.status;
  if (query?.tool) where.tool = query.tool;
  if (query?.search) {
    where.OR = [
      { packageName: { contains: query.search, mode: "insensitive" } },
      { filePath: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
      { reference: { contains: query.search, mode: "insensitive" } },
      { fingerprint: { contains: query.search, mode: "insensitive" } },
    ];
  }

  return where;
}

function groupRows(rows: Row[]): GroupedVulnerability[] {
  const map = new Map<string, GroupedVulnerability>();

  for (const row of rows) {
    const key = row.fingerprint ?? row.id;
    const scan = row.scan as ScanRef | null;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        id: row.id,
        fingerprint: row.fingerprint,
        tool: row.tool,
        technology: row.technology,
        severity: row.severity,
        packageName: row.packageName,
        filePath: row.filePath,
        version: row.version,
        fixedVersion: row.fixedVersion,
        description: row.description,
        reference: row.reference,
        status: row.status,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        detectedAt: row.lastSeenAt,
        occurrences: 1,
        assignedTo: row.assignedTo,
        notes: row.notes,
        dueDate: row.dueDate,
        scan,
        scans: scan ? [scan] : [],
      });
      continue;
    }

    existing.occurrences += 1;
    if (row.firstSeenAt < existing.firstSeenAt) {
      existing.firstSeenAt = row.firstSeenAt;
    }
    if (row.lastSeenAt >= existing.lastSeenAt) {
      // La ligne la plus récente porte le statut et l'assignation courants.
      existing.lastSeenAt = row.lastSeenAt;
      existing.detectedAt = row.lastSeenAt;
      existing.id = row.id;
      existing.status = row.status;
      existing.severity = row.severity;
      existing.fixedVersion = row.fixedVersion;
      existing.assignedTo = row.assignedTo;
      existing.notes = row.notes;
      existing.dueDate = row.dueDate;
      existing.scan = scan;
    }
    if (scan && !existing.scans.some((s) => s.id === scan.id)) {
      existing.scans.push(scan);
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  );
}

async function loadAllGroups(projectId: string): Promise<GroupedVulnerability[]> {
  const rows = await prisma.vulnerability.findMany({
    where: { scan: { projectId } },
    orderBy: { lastSeenAt: "desc" },
    select: SELECT,
  });
  return groupRows(rows as Row[]);
}

// ============================================================
// LISTE
// ============================================================

export async function listVulnerabilities(
  actor: ActorContext,
  projectId: string,
  query: VulnerabilityListQuery,
) {
  await ensureProjectAccess(actor, projectId);

  const rows = await prisma.vulnerability.findMany({
    where: buildWhere(projectId, query),
    orderBy: { lastSeenAt: "desc" },
    select: SELECT,
  });

  // Les filtres s'appliquent aux occurrences, puis on déduplique.
  const grouped = groupRows(rows as Row[]);

  const allGroups = await loadAllGroups(projectId);

  const severityCounts: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  const statusCounts: Record<VulnerabilityStatus, number> = {
    OPEN: 0,
    CONFIRMED: 0,
    FIXED: 0,
    FALSE_POSITIVE: 0,
    RISK_ACCEPTED: 0,
    DUPLICATE: 0,
  };

  let occurrenceCount = 0;
  for (const group of allGroups) {
    occurrenceCount += group.occurrences;
    if (isActiveStatus(group.status)) {
      severityCounts[group.severity] += 1;
    }
    statusCounts[group.status] += 1;
  }

  const total = grouped.length;
  const skip = (query.page - 1) * query.pageSize;
  const items = grouped.slice(skip, skip + query.pageSize);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    severityCounts,
    statusCounts,
    uniqueCount: allGroups.length,
    occurrenceCount,
  };
}

// ============================================================
// RÉSUMÉ / TABLEAU DE BORD
// ============================================================

export async function getVulnerabilitySummary(
  actor: ActorContext,
  projectId: string,
) {
  await ensureProjectAccess(actor, projectId);

  const groups = await loadAllGroups(projectId);

  const severityCounts: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  const statusCounts: Record<VulnerabilityStatus, number> = {
    OPEN: 0,
    CONFIRMED: 0,
    FIXED: 0,
    FALSE_POSITIVE: 0,
    RISK_ACCEPTED: 0,
    DUPLICATE: 0,
  };
  const toolCounts: Record<string, number> = {};
  const scanTypeCounts: Record<string, number> = {};

  let occurrenceCount = 0;
  for (const group of groups) {
    occurrenceCount += group.occurrences;
    statusCounts[group.status] += 1;
    if (isActiveStatus(group.status)) {
      severityCounts[group.severity] += 1;
      toolCounts[group.tool] = (toolCounts[group.tool] ?? 0) + 1;
      if (group.scan?.type) {
        scanTypeCounts[group.scan.type] =
          (scanTypeCounts[group.scan.type] ?? 0) + 1;
      }
    }
  }

  const openGroups = groups.filter((g) => isActiveStatus(g.status));

  return {
    severityCounts,
    statusCounts,
    toolCounts,
    scanTypeCounts,
    uniqueCount: groups.length,
    openCount: openGroups.length,
    occurrenceCount,
    topFindings: openGroups
      .filter((g) => g.severity === "CRITICAL" || g.severity === "HIGH")
      .slice(0, 10),
  };
}

// ============================================================
// MISE À JOUR DU CYCLE DE VIE
// ============================================================

export async function updateVulnerability(
  actor: ActorContext,
  projectId: string,
  vulnerabilityId: string,
  input: UpdateVulnerabilityInput,
) {
  await ensureProjectAccess(actor, projectId, PERMISSIONS.VULNERABILITY_UPDATE);

  if (input.status === VulnerabilityStatus.RISK_ACCEPTED) {
    const allowed = await hasSpecialPermission(
      actor,
      SpecialPermission.ACCEPT_SECURITY_RISK,
      projectId,
    );
    if (!allowed) {
      throw new ForbiddenError(
        "L'acceptation d'un risque nécessite la permission spéciale ACCEPT_SECURITY_RISK",
      );
    }
  }

  const row = await prisma.vulnerability.findFirst({
    where: { id: vulnerabilityId, scan: { projectId } },
    select: {
      id: true,
      fingerprint: true,
      scanId: true,
      status: true,
    },
  });
  if (!row) throw new NotFoundError("Vulnérabilité introuvable");

  if (input.assignedToId) {
    const user = await prisma.user.findUnique({
      where: { id: input.assignedToId },
      select: { id: true },
    });
    if (!user) throw new NotFoundError("Utilisateur assigné introuvable");
  }

  const data: Prisma.VulnerabilityUncheckedUpdateManyInput = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate;
  if (input.assignedToId !== undefined) {
    data.assignedToId = input.assignedToId;
  }

  // Le statut s'applique à toutes les occurrences du même finding.
  const where: Prisma.VulnerabilityWhereInput = row.fingerprint
    ? { fingerprint: row.fingerprint, scan: { projectId } }
    : { id: row.id };

  const result = await prisma.vulnerability.updateMany({ where, data });


  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "VULNERABILITY_UPDATED",
      targetType: "Vulnerability",
      targetId: row.id,
      metadataJson: {
        projectId,
        fingerprint: row.fingerprint,
        status: input.status ?? null,
        assignedToId: input.assignedToId ?? null,
        dueDate: input.dueDate?.toISOString() ?? null,
        occurrencesUpdated: result.count,
      },
    },
  });

  const updated = await prisma.vulnerability.findUnique({
    where: { id: row.id },
    select: SELECT,
  });

  return {
    updatedOccurrences: result.count,
    vulnerability: updated,
  };
}
