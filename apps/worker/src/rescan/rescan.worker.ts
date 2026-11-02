// apps/worker/src/rescan/rescan.worker.ts
import { Job, Worker } from "bullmq";
import {
  DeploymentStatus,
  Prisma,
  RescanStatus,
  Role,
  ScanType,
  Severity,
} from "@prisma/client";
import {
  RESCAN_QUEUE_NAME,
  RESCAN_RUN_JOB,
  RESCAN_TICK_JOB,
  isRescanRunJobData,
  isTransientNetworkError,
  type RescanJobData,
} from "@devsecops/shared";
import type { ScanResult } from "@devsecops/scanners";
import { prisma } from "../utils/prisma";
import { logger } from "../utils/logger";
import { decryptString } from "../utils/crypto";
import { SshRunner } from "../runners/ssh.runner";
import {
  fingerprintFinding,
  persistScanResult,
} from "../orchestrator/scanner.helper";
import { redisConnection } from "../queues/connection";
import { rescanQueue } from "./rescan.queue";
import {
  compareRescanFindings,
  type RescanComparison,
  type RescanFinding,
} from "./rescan.comparison";
import {
  buildRescanFailureNotification,
  buildRescanRiskNotification,
  type RescanNotificationContent,
} from "./rescan.notifications";
import {
  computeNextRescanAt,
  cycleKeyFor,
  dailyLimitReached,
  normalizeRescanControls,
} from "./rescan.policy";
import { scanDeployedImageByDigest } from "./rescan-image.scan";

class RescanTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RescanTimeoutError";
  }
}

type RunWithRelations = NonNullable<
  Awaited<ReturnType<typeof loadRescanRun>>
>;

async function loadRescanRun(runId: string) {
  return prisma.rescanRun.findUnique({
    where: { id: runId },
    include: {
      project: { select: { id: true, name: true, ownerId: true } },
      server: true,
      deployment: {
        select: { id: true, imageTag: true, imageDigest: true },
      },
    },
  });
}

async function notifyProject(
  projectId: string,
  content: RescanNotificationContent,
): Promise<void> {
  try {
    const [project, admins] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true },
      }),
      prisma.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true },
      }),
    ]);
    const recipients = new Set<string>();
    if (project?.ownerId) recipients.add(project.ownerId);
    for (const admin of admins) recipients.add(admin.id);
    if (recipients.size === 0) return;

    await prisma.notification.createMany({
      data: [...recipients].map((userId) => ({
        userId,
        sourceKey: content.sourceKey,
        kind: content.kind,
        title: content.title,
        message: content.message,
        link: content.link,
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    logger.warn(
      {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Rescan : notification impossible",
    );
  }
}

/**
 * Tick unique : sélectionne les politiques échues. L'échéance est avancée
 * atomiquement avant de créer le rescan, et `(deploymentId, cycleKey)` est
 * unique : deux ticks concurrents ne peuvent pas produire deux rescans pour
 * la même version et le même cycle.
 */
export async function runRescanSchedulerTick(
  now: Date = new Date(),
): Promise<{ scheduled: number; skipped: number }> {
  const due = await prisma.projectConfiguration.findMany({
    where: {
      rescanEnabled: true,
      rescanNextRunAt: { lte: now },
    },
    orderBy: { rescanNextRunAt: "asc" },
    take: 50,
    select: {
      projectId: true,
      rescanIntervalHours: true,
      rescanMaxRunsPerDay: true,
      rescanControls: true,
      rescanTimeoutMs: true,
      rescanNextRunAt: true,
    },
  });

  let scheduled = 0;
  let skipped = 0;

  for (const config of due) {
    if (!config.rescanNextRunAt) continue;
    const cycleKey = cycleKeyFor(config.rescanNextRunAt);
    const nextRunAt = computeNextRescanAt(
      config.rescanNextRunAt,
      config.rescanIntervalHours,
      now,
    );

    // Revendication atomique de CE cycle. Le second worker concurrent
    // échoue ici et ne crée aucun job.
    const claimed = await prisma.projectConfiguration.updateMany({
      where: {
        projectId: config.projectId,
        rescanEnabled: true,
        rescanNextRunAt: config.rescanNextRunAt,
      },
      data: { rescanNextRunAt: nextRunAt },
    });
    if (claimed.count === 0) {
      skipped++;
      continue;
    }

    const runsLast24h = await prisma.rescanRun.count({
      where: {
        projectId: config.projectId,
        createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) },
        status: { not: RescanStatus.CANCELLED },
      },
    });
    if (dailyLimitReached(runsLast24h, config.rescanMaxRunsPerDay)) {
      await prisma.auditLog.create({
        data: {
          action: "RESCAN_SKIPPED_DAILY_LIMIT",
          targetType: "Project",
          targetId: config.projectId,
          metadataJson: {
            runsLast24h,
            maxRunsPerDay: config.rescanMaxRunsPerDay,
            nextRunAt: nextRunAt.toISOString(),
          },
        },
      });
      skipped++;
      continue;
    }

    const active = await prisma.rescanRun.findFirst({
      where: {
        projectId: config.projectId,
        status: { in: [RescanStatus.QUEUED, RescanStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (active) {
      await prisma.auditLog.create({
        data: {
          action: "RESCAN_SKIPPED_ALREADY_ACTIVE",
          targetType: "Project",
          targetId: config.projectId,
          metadataJson: { activeRunId: active.id, cycleKey },
        },
      });
      skipped++;
      continue;
    }

    const controls = normalizeRescanControls(config.rescanControls);
    if (controls.length === 0) {
      await prisma.auditLog.create({
        data: {
          action: "RESCAN_SKIPPED_NO_CONTROL",
          targetType: "Project",
          targetId: config.projectId,
          metadataJson: { configuredControls: config.rescanControls },
        },
      });
      skipped++;
      continue;
    }

    const deployment = await prisma.deployment.findFirst({
      where: {
        projectId: config.projectId,
        environment: "PRODUCTION",
        status: DeploymentStatus.SUCCESS,
        imageDigest: { not: null },
        imageTag: { not: null },
      },
      orderBy: { finishedAt: "desc" },
      include: {
        pipeline: { select: { commitSha: true, branch: true } },
      },
    });

    if (
      !deployment?.imageDigest ||
      !deployment.pipeline ||
      !deployment.serverId
    ) {
      await prisma.auditLog.create({
        data: {
          action: "RESCAN_SKIPPED_NO_DEPLOYMENT",
          targetType: "Project",
          targetId: config.projectId,
          metadataJson: { cycleKey },
        },
      });
      skipped++;
      continue;
    }

    let run;
    try {
      run = await prisma.rescanRun.create({
        data: {
          projectId: config.projectId,
          deploymentId: deployment.id,
          pipelineId: deployment.pipelineId,
          serverId: deployment.serverId,
          environment: "PRODUCTION",
          commitSha: deployment.pipeline.commitSha,
          branch: deployment.pipeline.branch,
          imageTag: deployment.imageTag,
          imageDigest: deployment.imageDigest,
          cycleKey,
          trigger: "SCHEDULED",
          controls,
          timeoutMs: Math.min(
            60 * 60_000,
            Math.max(30_000, config.rescanTimeoutMs),
          ),
        },
      });
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "P2002"
      ) {
        skipped++;
        continue;
      }
      throw err;
    }

    await rescanQueue.add(
      RESCAN_RUN_JOB,
      { rescanRunId: run.id },
      {
        jobId: `rescan:${run.id}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 60_000 },
      },
    );

    await prisma.auditLog.create({
      data: {
        action: "RESCAN_SCHEDULED",
        targetType: "RescanRun",
        targetId: run.id,
        metadataJson: {
          projectId: config.projectId,
          deploymentId: deployment.id,
          imageDigest: deployment.imageDigest,
          cycleKey,
          controls,
        },
      },
    });
    scheduled++;
  }

  return { scheduled, skipped };
}

async function scanRun(run: RunWithRelations): Promise<ScanResult> {
  const server = run.server;
  if (!server.encryptedPrivateKey) {
    throw new Error("Clé SSH du serveur manquante");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(run.imageDigest)) {
    throw new Error("Digest de l'artefact invalide ou absent");
  }

  const privateKey = decryptString(server.encryptedPrivateKey);
  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const ssh = new SshRunner();
  try {
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });

    const unsupported = normalizeRescanControls(run.controls).filter(
      (control) => control !== "IMAGE",
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Contrôle(s) de rescan non supporté(s) pour un artefact livré : ${unsupported.join(", ")}`,
      );
    }

    return await scanDeployedImageByDigest({
      ssh,
      imageDigest: run.imageDigest,
      imageTag: run.imageTag,
      rescanRunId: run.id,
      timeoutMs: run.timeoutMs,
      onLog: async (level, message) => {
        logger[level](
          { rescanRunId: run.id, projectId: run.projectId },
          message,
        );
      },
    });
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}

async function loadBaseline(run: RunWithRelations): Promise<{
  scanIds: string[];
  source: string | null;
  findings: RescanFinding[];
}> {
  const previous = await prisma.rescanRun.findFirst({
    where: {
      deploymentId: run.deploymentId,
      id: { not: run.id },
      status: RescanStatus.SUCCESS,
      scans: { some: {} },
    },
    orderBy: { finishedAt: "desc" },
    select: {
      id: true,
      scans: { select: { id: true } },
    },
  });

  let scanIds = previous?.scans.map((scan) => scan.id) ?? [];
  let source: string | null = previous ? `rescan:${previous.id}` : null;

  if (scanIds.length === 0 && run.pipelineId) {
    const pipelineScans = await prisma.securityScan.findMany({
      where: {
        pipelineId: run.pipelineId,
        type: ScanType.IMAGE,
      },
      select: { id: true },
    });
    scanIds = pipelineScans.map((scan) => scan.id);
    if (scanIds.length > 0) source = `pipeline:${run.pipelineId}`;
  }

  if (scanIds.length === 0) {
    return { scanIds, source, findings: [] };
  }

  const rows = await prisma.vulnerability.findMany({
    where: { scanId: { in: scanIds } },
    select: {
      fingerprint: true,
      severity: true,
      tool: true,
      packageName: true,
      filePath: true,
      reference: true,
      description: true,
      status: true,
    },
  });

  return {
    scanIds,
    source,
    findings: rows
      .filter(
        (row): row is typeof row & { fingerprint: string } =>
          typeof row.fingerprint === "string" && row.fingerprint.length > 0,
      )
      .map((row) => ({
        fingerprint: row.fingerprint,
        severity: row.severity,
        tool: row.tool,
        packageName: row.packageName,
        filePath: row.filePath,
        reference: row.reference,
        description: row.description,
        status: row.status,
      })),
  };
}

function currentFindings(
  projectId: string,
  result: ScanResult,
): RescanFinding[] {
  return result.findings.map((finding) => ({
    fingerprint: fingerprintFinding(projectId, finding),
    severity: finding.severity as Severity,
    tool: finding.tool,
    packageName: finding.packageName,
    filePath: finding.filePath,
    reference: finding.reference,
    description: finding.description,
  }));
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new RescanTimeoutError(
            `Rescan interrompu après ${Math.round(ms / 1000)}s`,
          ),
        ),
      ms,
    );
    timer.unref?.();
  });
}

async function processRescanRun(
  job: Job<RescanJobData>,
  runId: string,
): Promise<void> {
  const run = await loadRescanRun(runId);
  if (!run) {
    logger.warn({ runId }, "Rescan introuvable — job ignoré");
    return;
  }
  if (run.status === RescanStatus.CANCELLED || run.status === RescanStatus.SUCCESS) {
    return;
  }

  const config = await prisma.projectConfiguration.findUnique({
    where: { projectId: run.projectId },
    select: { rescanEnabled: true },
  });
  if (!config?.rescanEnabled) {
    await prisma.rescanRun.update({
      where: { id: run.id },
      data: {
        status: RescanStatus.CANCELLED,
        finishedAt: new Date(),
        error: "Rescan désactivé par la configuration du projet",
      },
    });
    await prisma.auditLog.create({
      data: {
        action: "RESCAN_CANCELLED_POLICY_DISABLED",
        targetType: "RescanRun",
        targetId: run.id,
        metadataJson: { projectId: run.projectId },
      },
    });
    return;
  }

  // Une reprise ne doit pas conserver des scans partiels du tentative
  // précédente. Les historiques des runs réussis ne sont jamais touchés.
  await prisma.securityScan.deleteMany({ where: { rescanRunId: run.id } });

  const startedAt = new Date();
  await prisma.rescanRun.update({
    where: { id: run.id },
    data: {
      status: RescanStatus.RUNNING,
      startedAt,
      finishedAt: null,
      durationMs: null,
      error: null,
    },
  });
  await prisma.auditLog.create({
    data: {
      action: "RESCAN_STARTED",
      targetType: "RescanRun",
      targetId: run.id,
      metadataJson: {
        imageDigest: run.imageDigest,
        controls: run.controls,
      },
    },
  });

  try {
    const result = await Promise.race([
      scanRun(run),
      timeoutPromise(run.timeoutMs),
    ]);

    const fresh = await prisma.rescanRun.findUnique({
      where: { id: run.id },
      select: { status: true },
    });
    if (fresh?.status === RescanStatus.CANCELLED) {
      return;
    }

    const baseline = await loadBaseline(run);
    const current = currentFindings(run.projectId, result);
    const comparison: RescanComparison = compareRescanFindings(
      baseline.findings,
      current,
      { baselineAvailable: baseline.scanIds.length > 0 },
    );

    const persisted = await persistScanResult(
      {
        projectId: run.projectId,
        rescanRunId: run.id,
        type: ScanType.IMAGE,
      },
      result,
    );

    const finishedAt = new Date();
    const summary = {
      scanId: persisted.scanId,
      scanner: result.scanner,
      scannerVersion: result.scannerVersion ?? null,
      vulnerabilityCount: result.vulnerabilityCount,
      severityCounts: result.severityCounts,
      controls: run.controls,
      baseline: {
        source: baseline.source,
        scanIds: baseline.scanIds,
        available: baseline.scanIds.length > 0,
        findings: comparison.baselineFingerprints,
      },
      currentFindings: comparison.currentFingerprints,
      riskFound: comparison.riskFound,
      evolution: comparison.counts,
    };

    await prisma.rescanRun.update({
      where: { id: run.id },
      data: {
        status: RescanStatus.SUCCESS,
        scannerVersion: result.scannerVersion ?? null,
        summaryJson: summary as unknown as Prisma.InputJsonValue,
        comparisonJson: comparison as unknown as Prisma.InputJsonValue,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: null,
      },
    });
    await prisma.projectConfiguration.update({
      where: { projectId: run.projectId },
      data: { rescanLastRunAt: finishedAt },
    });

    await prisma.auditLog.create({
      data: {
        action: "RESCAN_COMPLETED",
        targetType: "RescanRun",
        targetId: run.id,
        metadataJson: {
          imageDigest: run.imageDigest,
          vulnerabilityCount: result.vulnerabilityCount,
          newFindings: comparison.counts.new,
          severityIncreased: comparison.counts.severityIncreased,
          resolved: comparison.counts.resolved,
          riskFound: comparison.riskFound,
        },
      },
    });

    if (comparison.riskFound) {
      await prisma.auditLog.create({
        data: {
          action: "RESCAN_RISK_DETECTED",
          targetType: "RescanRun",
          targetId: run.id,
          metadataJson: {
            newFindings: comparison.counts.new,
            severityIncreased: comparison.counts.severityIncreased,
            newBySeverity: comparison.counts.newBySeverity,
          },
        },
      });
      const content = buildRescanRiskNotification({
        projectId: run.projectId,
        projectName: run.project.name,
        rescanRunId: run.id,
        commitSha: run.commitSha,
        imageTag: run.imageTag,
        comparison,
      });
      if (content) await notifyProject(run.projectId, content);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timeout =
      err instanceof RescanTimeoutError ||
      /timed?\s*out|timeout|délai maximal/iu.test(message);
    const transient = isTransientNetworkError(err);
    const totalAttempts = job.opts.attempts ?? 1;
    const canRetry = transient && job.attemptsMade + 1 < totalAttempts;

    await prisma.rescanRun.update({
      where: { id: run.id },
      data: {
        status: canRetry
          ? RescanStatus.QUEUED
          : timeout
            ? RescanStatus.TIMED_OUT
            : RescanStatus.FAILED,
        finishedAt: canRetry ? null : new Date(),
        durationMs: canRetry ? null : Date.now() - startedAt.getTime(),
        error: message.slice(0, 2000),
      },
    });

    if (canRetry) {
      logger.warn(
        { rescanRunId: run.id, error: message },
        "Rescan : erreur réseau transitoire, nouvelle tentative planifiée",
      );
      throw err;
    }

    await prisma.auditLog.create({
      data: {
        action: timeout ? "RESCAN_TIMED_OUT" : "RESCAN_FAILED",
        targetType: "RescanRun",
        targetId: run.id,
        metadataJson: {
          error: message.slice(0, 1000),
          transient,
        },
      },
    });
    await notifyProject(
      run.projectId,
      buildRescanFailureNotification({
        projectId: run.projectId,
        projectName: run.project.name,
        rescanRunId: run.id,
        imageTag: run.imageTag,
        error: message,
      }),
    );
    logger.error(
      { rescanRunId: run.id, error: message, timeout, transient },
      "Rescan échoué",
    );
  }
}

async function processJob(job: Job<RescanJobData>): Promise<void> {
  if (job.name === RESCAN_TICK_JOB) {
    const result = await runRescanSchedulerTick();
    logger.info(result, "Rescan : tick de planification terminé");
    return;
  }
  if (job.name !== RESCAN_RUN_JOB || !isRescanRunJobData(job.data)) {
    throw new Error(`Job rescan inconnu : ${job.name}`);
  }
  await processRescanRun(job, job.data.rescanRunId);
}

export function startRescanWorker(): Worker<RescanJobData> {
  const worker = new Worker<RescanJobData>(RESCAN_QUEUE_NAME, processJob, {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 70 * 60_000,
    lockRenewTime: 10 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, name: job.name }, "Job rescan terminé");
  });
  worker.on("failed", (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        name: job?.name,
        error: err instanceof Error ? err.message : String(err),
      },
      "Job rescan échoué",
    );
  });
  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "Job rescan stalled");
  });
  worker.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Missing lock") || message.includes("could not renew lock")) {
      return;
    }
    logger.error({ error: message }, "Worker rescan : erreur");
  });

  return worker;
}
