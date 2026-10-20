// apps/api/src/modules/webhooks/webhooks.controller.ts
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { PipelineStatus, StepStatus } from "@prisma/client";
import { logger } from "../../utils/logger";
import { prisma } from "../../utils/prisma";
import { pipelineQueue } from "../../queues/pipeline.queue";
import * as installService from "../github/installations.service";
import { getGithubConfigInternal } from "../system-config/system-config.service";
import { buildDefaultSteps } from "../pipelines/pipeline.steps";

// ============================================================
// VÉRIFICATION SIGNATURE
// ============================================================

async function verifySignature(
  rawBody: string,
  signature: string | undefined,
): Promise<{ valid: boolean; reason?: string }> {
  if (!signature || !signature.startsWith("sha256=")) {
    return { valid: false, reason: "missing_signature" };
  }

  const config = await getGithubConfigInternal();
  if (!config || !config.webhookSecret) {
    return { valid: false, reason: "webhook_not_configured" };
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex")}`;

  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
    return { valid: ok, reason: ok ? undefined : "invalid_signature" };
  } catch {
    return { valid: false, reason: "invalid_signature" };
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================

export async function githubWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const event = req.headers["x-github-event"] as string;
  const delivery = req.headers["x-github-delivery"] as string;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";

  const verification = await verifySignature(rawBody, signature);

  if (!verification.valid) {
    // Si le webhook n'est juste pas configuré, on répond 200 pour ne pas
    // faire échouer GitHub (utile en mode déclenchement manuel uniquement).
    if (verification.reason === "webhook_not_configured") {
      logger.debug(
        { delivery },
        "Webhook reçu mais non configuré — ignoré silencieusement",
      );
      res.status(200).json({ status: "ignored", reason: "not_configured" });
      return;
    }

    logger.warn(
      { delivery, reason: verification.reason },
      "Webhook GitHub : signature invalide",
    );
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Réponse immédiate
  res.status(202).json({ status: "accepted" });

  // Traitement asynchrone
  try {
    const already = await prisma.webhookEvent.findUnique({
      where: { deliveryId: delivery },
      select: { id: true, processedAt: true },
    });
    if (already?.processedAt) {
      logger.debug({ delivery }, "Webhook déjà traité");
      return;
    }

    const payload = JSON.parse(rawBody);
    const webhookRecord = await prisma.webhookEvent.upsert({
      where: { deliveryId: delivery },
      create: {
        provider: "GITHUB",
        eventType: event ?? "unknown",
        deliveryId: delivery ?? `no-delivery-${Date.now()}`,
        payloadJson: payload,
        signatureValid: true,
        status: "received",
      },
      update: {},
      select: { id: true },
    });

    switch (event) {
      case "push":
        await handlePush(payload, webhookRecord.id);
        break;

      case "pull_request":
        await handlePullRequest(payload, webhookRecord.id);
        break;

      case "installation":
        await installService.handleInstallationEvent(payload);
        break;

      case "installation_repositories":
        await handleInstallationRepositories(payload);
        break;

      case "ping":
        logger.info({ delivery }, "Ping GitHub reçu (setup OK)");
        break;

      default:
        logger.debug({ event }, "Événement GitHub ignoré");
    }

    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processedAt: new Date(), status: "processed" },
    });
  } catch (err) {
    logger.error({ err, delivery }, "Erreur traitement webhook GitHub");
    try {
      await prisma.webhookEvent.update({
        where: { deliveryId: delivery },
        data: {
          status: "failed",
          processedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // ignore
    }
  }
}

// ============================================================
// PUSH HANDLER
// ============================================================

interface PushEvent {
  ref: string;
  before: string;
  after: string;
  installation?: { id: number };
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
    owner: { login: string };
  };
  pusher: { name: string; email: string };
  sender: { login: string };
  head_commit: {
    id: string;
    message: string;
    author: { name: string; email: string };
  } | null;
}

async function handlePush(payload: PushEvent, webhookRecordId: string) {
  const branch = payload.ref.replace("refs/heads/", "");
  const repoId = String(payload.repository.id);
  const commitSha = payload.after;

  logger.info(
    { repo: payload.repository.full_name, branch, commitSha },
    "Push GitHub reçu",
  );

  const repo = await prisma.gitHubRepository.findFirst({
    where: { repositoryId: repoId },
    select: {
      id: true,
      fullName: true,
      installation: { select: { revokedAt: true, suspendedAt: true } },
    },
  });

  if (!repo) {
    logger.debug({ repoId }, "Repository inconnu — push ignoré");
    return;
  }
  if (repo.installation.revokedAt || repo.installation.suspendedAt) {
    logger.warn(
      { repoId },
      "Installation révoquée ou suspendue — push ignoré",
    );
    return;
  }

  const projects = await prisma.project.findMany({
    where: { githubRepositoryId: repo.id },
    include: {
      config: true,
      owner: { select: { id: true } },
    },
  });

  if (projects.length === 0) {
    logger.debug({ repoId }, "Aucun projet lié — push ignoré");
    return;
  }

  for (const project of projects) {
    const monitored = project.monitoredBranch ?? project.defaultBranch;
    if (monitored !== branch) {
      logger.debug(
        { projectId: project.id, branch, monitored },
        "Branche non surveillée — pipeline ignoré",
      );
      continue;
    }

    const pipeline = await prisma.$transaction(async (tx) => {
      const created = await tx.pipeline.create({
        data: {
          projectId: project.id,
          commitSha,
          branch,
          author: payload.pusher.name,
          trigger: "push",
          status: PipelineStatus.QUEUED,
        },
        select: { id: true },
      });

      const config = project.config;
      if (!config) {
        throw new Error(
          `Configuration introuvable pour le projet ${project.id}`,
        );
      }
      const steps = buildDefaultSteps(config);

      await tx.pipelineStep.createMany({
        data: steps.map((s) => ({
          pipelineId: created.id,
          name: s.name,
          type: s.type,
          order: s.order,
          status: StepStatus.QUEUED,
          resultJson: { critical: s.critical },
        })),
      });

      await tx.auditLog.create({
        data: {
          userId: project.owner.id,
          action: "PIPELINE_TRIGGERED_BY_WEBHOOK",
          targetType: "Pipeline",
          targetId: created.id,
          metadataJson: {
            repoFullName: repo.fullName,
            branch,
            commitSha,
            pusher: payload.pusher.name,
          },
        },
      });

      return created;
    });

    await pipelineQueue.add(
      "run",
      { pipelineId: pipeline.id },
      { jobId: pipeline.id },
    );

    await prisma.webhookEvent.update({
      where: { id: webhookRecordId },
      data: { projectId: project.id, pipelineId: pipeline.id },
    });

    logger.info(
      { pipelineId: pipeline.id, projectId: project.id },
      "Pipeline déclenché par webhook",
    );
  }
}

// ============================================================
// PULL_REQUEST HANDLER
// ============================================================

interface PullRequestEvent {
  action: string;
  number: number;
  installation?: { id: number };
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
    owner: { login: string };
  };
  pull_request: {
    number: number;
    html_url: string;
    title: string;
    draft?: boolean;
    state: string;
    user: { login: string };
    head: { sha: string; ref: string; repo: { full_name: string } | null };
    base: { ref: string; repo: { full_name: string } };
  };
  sender: { login: string };
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

async function handlePullRequest(
  payload: PullRequestEvent,
  webhookRecordId: string,
) {
  if (!PR_ACTIONS.has(payload.action)) {
    logger.debug(
      { action: payload.action, pr: payload.number },
      "Action pull_request ignorée",
    );
    return;
  }

  const repoId = String(payload.repository.id);
  const pr = payload.pull_request;

  if (pr.draft === true) {
    logger.debug({ pr: payload.number }, "Pull request en brouillon — ignorée");
    return;
  }

  const repo = await prisma.gitHubRepository.findFirst({
    where: { repositoryId: repoId },
    select: {
      id: true,
      fullName: true,
      installation: { select: { revokedAt: true, suspendedAt: true } },
    },
  });

  if (!repo) {
    logger.debug({ repoId }, "Repository inconnu — pull_request ignoré");
    return;
  }
  if (repo.installation.revokedAt || repo.installation.suspendedAt) {
    logger.warn(
      { repoId },
      "Installation révoquée ou suspendue — pull_request ignoré",
    );
    return;
  }

  const projects = await prisma.project.findMany({
    where: { githubRepositoryId: repo.id },
    include: {
      config: true,
      owner: { select: { id: true } },
    },
  });

  if (projects.length === 0) {
    logger.debug({ repoId }, "Aucun projet lié — pull_request ignoré");
    return;
  }

  for (const project of projects) {
    const monitored = project.monitoredBranch ?? project.defaultBranch;

    // On ne scanne que les PR qui ciblent la branche surveillée.
    if (pr.base.ref !== monitored) {
      logger.debug(
        { projectId: project.id, base: pr.base.ref, monitored },
        "PR ne cible pas la branche surveillée — ignorée",
      );
      continue;
    }

    if (!project.config) {
      logger.warn(
        { projectId: project.id },
        "Configuration projet manquante — pull_request ignoré",
      );
      continue;
    }

    // Évite les doublons pour le même commit de tête.
    const existing = await prisma.pipeline.findFirst({
      where: {
        projectId: project.id,
        commitSha: pr.head.sha,
        trigger: "pull_request",
        status: { in: [PipelineStatus.QUEUED, PipelineStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (existing) {
      logger.debug(
        { projectId: project.id, pipelineId: existing.id },
        "Pipeline PR déjà en cours pour ce commit — ignoré",
      );
      continue;
    }

    const pipeline = await prisma.$transaction(async (tx) => {
      const created = await tx.pipeline.create({
        data: {
          projectId: project.id,
          commitSha: pr.head.sha,
          branch: pr.head.ref,
          baseBranch: pr.base.ref,
          author: payload.sender.login,
          trigger: "pull_request",
          pullRequestNumber: payload.number,
          pullRequestUrl: pr.html_url,
          status: PipelineStatus.QUEUED,
        },
        select: { id: true },
      });

      const steps = buildDefaultSteps(project.config!);

      await tx.pipelineStep.createMany({
        data: steps.map((s) => ({
          pipelineId: created.id,
          name: s.name,
          type: s.type,
          order: s.order,
          status: StepStatus.QUEUED,
          resultJson: { critical: s.critical },
        })),
      });

      await tx.auditLog.create({
        data: {
          userId: project.owner.id,
          action: "PIPELINE_TRIGGERED_BY_PULL_REQUEST",
          targetType: "Pipeline",
          targetId: created.id,
          metadataJson: {
            repoFullName: repo.fullName,
            pullRequestNumber: payload.number,
            pullRequestUrl: pr.html_url,
            headSha: pr.head.sha,
            baseBranch: pr.base.ref,
          },
        },
      });

      return created;
    });

    await pipelineQueue.add(
      "run",
      { pipelineId: pipeline.id },
      { jobId: pipeline.id },
    );

    await prisma.webhookEvent.update({
      where: { id: webhookRecordId },
      data: { projectId: project.id, pipelineId: pipeline.id },
    });

    logger.info(
      {
        pipelineId: pipeline.id,
        projectId: project.id,
        pr: payload.number,
      },
      "Pipeline déclenché par pull_request",
    );
  }
}

// ============================================================
// INSTALLATION_REPOSITORIES HANDLER
// ============================================================

async function handleInstallationRepositories(payload: {
  action: string;
  installation: { id: number };
  repositories_added: Array<{ id: number }>;
  repositories_removed: Array<{ id: number }>;
}) {
  const installationId = String(payload.installation.id);

  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId },
    select: { id: true },
  });
  if (!installation) {
    logger.debug({ installationId }, "Installation inconnue — ignoré");
    return;
  }

  await installService.syncRepositories(installationId);

  logger.info(
    {
      installationId,
      added: payload.repositories_added.length,
      removed: payload.repositories_removed.length,
    },
    "Repositories de l'installation mis à jour",
  );
}