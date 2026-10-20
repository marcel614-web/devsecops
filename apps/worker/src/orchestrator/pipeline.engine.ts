// apps/worker/src/orchestrator/pipeline.engine.ts
import path from "node:path";
import os from "node:os";
import { PipelineStatus, StepStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { logger } from "../utils/logger";
import { logStep } from "./pipeline.logger";
import {
  markPipelineFinished,
  markPipelineRunning,
  markStepFinished,
  markStepRunning,
} from "./pipeline.status";
import { executeStep, type StepContext } from "./step.executor";
import {
  isPipelineCancelled,
  clearPipelineCancellation,
} from "../utils/cancellation";
import { postPullRequestCheck } from "../services/github-checks.service";

const WORKSPACES_ROOT = path.join(os.tmpdir(), "devsecops-workspaces");

/**
 * Si une promotion est sautée (gate bloquant, annulation ou échec
 * critique en amont), le déploiement de staging ne doit pas rester
 * éternellement en RUNNING dans l'interface.
 */
async function markPromotionSkipped(
  pipelineId: string,
  reason: string,
): Promise<void> {
  await prisma.deployment.updateMany({
    where: {
      pipelineId,
      environment: "STAGING",
      stagingStatus: "SUCCESS",
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      error: reason,
    },
  });
}

export async function runPipeline(pipelineId: string): Promise<void> {
  logger.info({ pipelineId }, "Démarrage du pipeline");

  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    include: {
      project: {
        select: {
          id: true,
          repoFullName: true,
          defaultBranch: true,
          ownerId: true,
          githubRepository: {
            select: {
              fullName: true,
              installation: { select: { installationId: true } },
            },
          },
        },
      },
      steps: { orderBy: { order: "asc" } },
    },
  });

  if (!pipeline) {
    logger.error({ pipelineId }, "Pipeline introuvable en base");
    return;
  }

  if (pipeline.status === PipelineStatus.CANCELLED) {
    logger.warn({ pipelineId }, "Pipeline déjà annulé, rien à faire");
    await clearPipelineCancellation(pipelineId);
    return;
  }

  await markPipelineRunning(pipelineId);
  await logStep(pipelineId, null, "info", `Pipeline ${pipelineId} démarré`);
  await logStep(
    pipelineId,
    null,
    "info",
    `Repository : ${pipeline.project.repoFullName} — branche ${pipeline.branch}`,
  );

  const workspaceDir = path.join(WORKSPACES_ROOT, pipelineId);

  // --- Flags de contrôle ---
  let aborted = false;         // arrêt dû à un échec critique OU à une annulation
  let cancelled = false;       // annulation demandée par l'utilisateur
  let securityBlocked = false; // Security Gate bloqué
  let abortReason: string | null = null;

  for (const step of pipeline.steps) {
    // ------------------------------------------------------------
    // 0. Vérifie une demande d'annulation AVANT de démarrer l'étape
    // ------------------------------------------------------------
    if (!cancelled && (await isPipelineCancelled(pipelineId))) {
      cancelled = true;
      aborted = true;
      abortReason = "Annulation demandée par l'utilisateur";
      await logStep(
        pipelineId,
        null,
        "warn",
        "Annulation détectée — arrêt du pipeline",
      );
    }

    // ------------------------------------------------------------
    // 1. Échec critique ou annulation → on saute TOUT, sauf le rapport
    //    final si le pipeline n'a pas été annulé (traçabilité).
    // ------------------------------------------------------------
    const isReportStep = step.type === "REPORT";
    if (
      aborted &&
      !securityBlocked &&
      !(isReportStep && !cancelled)
    ) {
      await markStepFinished(step.id, StepStatus.CANCELLED, {
        error: abortReason ?? "Pipeline interrompu",
      });
      if (step.type === "PROMOTE") {
        await markPromotionSkipped(
          pipelineId,
          abortReason ?? "Pipeline interrompu avant la promotion",
        );
      }
      await logStep(
        pipelineId,
        step.id,
        "warn",
        `Étape sautée : ${step.name} (${cancelled ? "annulé" : "pipeline interrompu"})`,
      );
      continue;
    }

    // ------------------------------------------------------------
    // 2. Security Gate a bloqué → on saute Deployment/ZAP mais
    //    PAS Final Report.
    // ------------------------------------------------------------
    if (securityBlocked && step.type !== "REPORT") {
      await markStepFinished(step.id, StepStatus.CANCELLED, {
        error: "Déploiement bloqué par le Security Gate",
      });
      if (step.type === "PROMOTE") {
        await markPromotionSkipped(
          pipelineId,
          "Promotion bloquée par le Security Gate",
        );
      }
      await logStep(
        pipelineId,
        step.id,
        "warn",
        `Étape sautée : ${step.name} (Security Gate bloqué)`,
      );
      continue;
    }

    const isCritical =
      (step.resultJson as { critical?: boolean } | null)?.critical === true;

    await markStepRunning(step.id);
    await logStep(pipelineId, step.id, "info", `Démarrage étape : ${step.name}`);

    const ctx: StepContext = {
      pipelineId,
      projectId: pipeline.project.id,
      stepId: step.id,
      workspaceDir,
      repoFullName: pipeline.project.repoFullName,
      commitSha: pipeline.commitSha,
      branch: pipeline.branch,
      log: (level, message) => logStep(pipelineId, step.id, level, message),
      isCancelled: () => isPipelineCancelled(pipelineId),
      pipelineAborted: aborted,
      pipelineSecurityBlocked: securityBlocked,
    };

    let result;
    try {
      result = await executeStep(step, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logStep(pipelineId, step.id, "error", `Exception : ${msg}`);
      result = { success: false, exitCode: 1, error: msg };
    }

    // ------------------------------------------------------------
    // 3. Vérifie une annulation APRES l'étape (peut être arrivée
    //    pendant son exécution)
    // ------------------------------------------------------------
    if (!cancelled && (await isPipelineCancelled(pipelineId))) {
      cancelled = true;
      aborted = true;
      abortReason = "Annulation demandée par l'utilisateur";
      await logStep(
        pipelineId,
        null,
        "warn",
        "Annulation détectée après l'étape — arrêt du pipeline",
      );
    }

    // ------------------------------------------------------------
    // 4. Cas spécial : Security Gate a bloqué le déploiement
    // ------------------------------------------------------------
    if (result.blockDeployment === true) {
      await markStepFinished(step.id, StepStatus.SECURITY_BLOCKED, {
        exitCode: result.exitCode ?? 1,
        error: result.error ?? "Security Gate bloqué",
        resultJson: result.data,
      });
      await logStep(
        pipelineId,
        step.id,
        "error",
        `Étape ${step.name} : SECURITY_BLOCKED — ${result.error ?? ""}`,
      );

      securityBlocked = true;
      abortReason = `Security Gate bloqué : ${result.error ?? ""}`;

      await logStep(
        pipelineId,
        null,
        "warn",
        `Pipeline : déploiement bloqué — Deployment et ZAP seront sautés`,
      );
      continue;
    }

    // ------------------------------------------------------------
    // 5. Cas normal : succès
    // ------------------------------------------------------------
    if (result.success) {
      await markStepFinished(step.id, StepStatus.SUCCESS, {
        exitCode: result.exitCode ?? 0,
        resultJson: result.data
          ? { ...(step.resultJson as object), ...result.data }
          : undefined,
      });
      await logStep(pipelineId, step.id, "info", `Étape réussie : ${step.name}`);
      continue;
    }

    // ------------------------------------------------------------
    // 6. Cas normal : échec
    // ------------------------------------------------------------
    await markStepFinished(step.id, StepStatus.FAILED, {
      exitCode: result.exitCode ?? 1,
      error: result.error ?? "Échec",
    });
    await logStep(
      pipelineId,
      step.id,
      "error",
      `Étape échouée : ${step.name} — ${result.error ?? ""}`,
    );

    if (isCritical) {
      aborted = true;
      abortReason = `Étape critique échouée : ${step.name}`;
      await logStep(
        pipelineId,
        null,
        "error",
        `Pipeline interrompu (étape critique) : ${step.name}`,
      );
    }
  }

  // ------------------------------------------------------------
  // Détermine le statut final
  // ------------------------------------------------------------
  const finalStatus = cancelled
    ? PipelineStatus.CANCELLED
    : securityBlocked
      ? PipelineStatus.SECURITY_BLOCKED
      : aborted
        ? PipelineStatus.FAILED
        : PipelineStatus.SUCCESS;

  // ------------------------------------------------------------
  // Ne réécrit PAS le statut si l'API l'a déjà positionné à CANCELLED.
  // (évite une race condition si l'utilisateur annule à la fin)
  // ------------------------------------------------------------
  const current = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: { status: true },
  });

  if (current?.status === PipelineStatus.CANCELLED) {
    await logStep(
      pipelineId,
      null,
      "info",
      "Pipeline déjà marqué CANCELLED — statut conservé",
    );
    logger.info(
      { pipelineId },
      "Pipeline terminé : statut CANCELLED déjà appliqué",
    );
  } else {
    await markPipelineFinished(pipelineId, finalStatus);
    await logStep(
      pipelineId,
      null,
      "info",
      `Pipeline terminé : ${finalStatus}`,
    );
    logger.info({ pipelineId, finalStatus }, "Pipeline terminé");
  }

  // ------------------------------------------------------------
  // Check run GitHub pour les pull requests
  // ------------------------------------------------------------
  const finalForCheck =
    current?.status === PipelineStatus.CANCELLED
      ? PipelineStatus.CANCELLED
      : finalStatus;

  if (
    pipeline.trigger === "pull_request" &&
    pipeline.project.githubRepository?.installation?.installationId
  ) {
    const gate = await prisma.securityGateResult.findUnique({
      where: { pipelineId },
      select: { status: true, reason: true },
    });

    await postPullRequestCheck({
      installationId:
        pipeline.project.githubRepository.installation.installationId,
      repoFullName: pipeline.project.githubRepository.fullName,
      headSha: pipeline.commitSha,
      pipelineId,
      status: finalForCheck,
      gateStatus: gate?.status ?? null,
      gateReason: gate?.reason ?? null,
      pullRequestNumber: pipeline.pullRequestNumber,
    });
  }

  // Nettoyage du flag Redis à la fin, quelle que soit l'issue.
  await clearPipelineCancellation(pipelineId);
}