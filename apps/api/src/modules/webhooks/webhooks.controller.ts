// apps/api/src/modules/webhooks/webhooks.controller.ts
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { PipelineStatus, StepStatus } from "@prisma/client";
import { logger } from "../../utils/logger";
import { prisma } from "../../utils/prisma";
import { pipelineQueue } from "../../queues/pipeline.queue";
import * as installService from "../github/installations.service";
import { getGithubConfigInternal } from "../system-config/system-config.service";

// ============================================================
// VÉRIFICATION SIGNATURE
// ============================================================

async function verifySignature(
  rawBody: string,
  signature: string | undefined,
): Promise<boolean> {
  if (!signature || !signature.startsWith("sha256=")) return false;

  const config = await getGithubConfigInternal();
  if (!config) {
    logger.warn("Webhook reçu mais GitHub App non configurée");
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
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

  // 1. Vérification signature (asynchrone car secret lu en base)
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";

  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    logger.warn({ delivery }, "Webhook GitHub : signature invalide");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // 2. Réponse immédiate (GitHub exige < 10 s)
  res.status(202).json({ status: "accepted" });

  // 3. Traitement asynchrone
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

    // Dispatch selon le type d'événement
    switch (event) {
      case "push":
        await handlePush(payload, webhookRecord.id);
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

  // Trouve le repository en base
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

  // Trouve les projets liés à ce repository
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
    // Vérifie que la branche surveillée matche
    const monitored = project.monitoredBranch ?? project.defaultBranch;
    if (monitored !== branch) {
      logger.debug(
        { projectId: project.id, branch, monitored },
        "Branche non surveillée — pipeline ignoré",
      );
      continue;
    }

    // Crée le pipeline + steps
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
      const steps: Array<{
        name: string;
        type: string;
        order: number;
        critical: boolean;
      }> = [
        { name: "Checkout", type: "CHECKOUT", order: 1, critical: true },
        {
          name: "Technology Detection",
          type: "DETECTION",
          order: 2,
          critical: true,
        },
        {
          name: "Install Dependencies",
          type: "INSTALL_DEPS",
          order: 3,
          critical: true,
        },
        { name: "Tests", type: "TESTS", order: 4, critical: false },
      ];
      let order = 5;

      if (config?.gitleaksEnabled) {
        steps.push({
          name: "Gitleaks",
          type: "SECRET_SCAN",
          order: order++,
          critical: false,
        });
      }
      if (config?.semgrepEnabled) {
        steps.push({
          name: "Semgrep",
          type: "SAST",
          order: order++,
          critical: false,
        });
      }
      if (config?.scaEnabled) {
        steps.push({ name: "SCA", type: "SCA", order: order++, critical: false });
      }

      steps.push({
        name: "Docker Build",
        type: "DOCKER_BUILD",
        order: order++,
        critical: true,
      });
      steps.push({
        name: "Trivy",
        type: "IMAGE_SCAN",
        order: order++,
        critical: false,
      });
      steps.push({
        name: "Security Gate",
        type: "SECURITY_GATE",
        order: order++,
        critical: true,
      });
      steps.push({
        name: "Deployment",
        type: "DEPLOYMENT",
        order: order++,
        critical: false,
      });

      if (config?.zapEnabled) {
        steps.push({
          name: "OWASP ZAP",
          type: "DAST",
          order: order++,
          critical: false,
        });
      }

      steps.push({
        name: "Final Report",
        type: "REPORT",
        order: order++,
        critical: false,
      });

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