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

const WORKSPACES_ROOT = path.join(os.tmpdir(), "devsecops-workspaces");

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
  //
  // aborted              → échec critique : on saute TOUT.
  // securityBlocked      → Security Gate a bloqué : on saute Deployment et ZAP,
  //                        mais on laisse passer Final Report.
  // deploymentSkipped    → alias utilisé dans la boucle pour sauter les étapes
  //                        post-gate hors Report.
  //
  let aborted = false;
  let abortReason: string | null = null;
  let securityBlocked = false;
  let deploymentSkipped = false;

  for (const step of pipeline.steps) {
    // 1. Échec critique → on saute TOUT sans distinction.
    if (aborted && !securityBlocked) {
      await markStepFinished(step.id, StepStatus.CANCELLED, {
        error: abortReason ?? "Pipeline interrompu",
      });
      await logStep(
        pipelineId,
        step.id,
        "warn",
        `Étape sautée : ${step.name} (pipeline interrompu)`,
      );
      continue;
    }

    // 2. Security Gate a bloqué → on saute Deployment/ZAP mais PAS Report.
    if (securityBlocked && step.type !== "REPORT") {
      await markStepFinished(step.id, StepStatus.CANCELLED, {
        error: "Déploiement bloqué par le Security Gate",
      });
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
    };

    let result;
    try {
      result = await executeStep(step, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logStep(pipelineId, step.id, "error", `Exception : ${msg}`);
      result = { success: false, exitCode: 1, error: msg };
    }

    // --- Cas spécial : Security Gate a bloqué le déploiement ---
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
      deploymentSkipped = true;
      abortReason = `Security Gate bloqué : ${result.error ?? ""}`;

      await logStep(
        pipelineId,
        null,
        "warn",
        `Pipeline : déploiement bloqué — les étapes Deployment et ZAP seront sautées`,
      );
      // On ne met PAS aborted=true : le Final Report doit tourner.
      continue;
    }

    // --- Cas normal : succès ---
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

    // --- Cas normal : échec ---
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

  // Statut final.
  const finalStatus = securityBlocked
    ? PipelineStatus.SECURITY_BLOCKED
    : aborted
      ? PipelineStatus.FAILED
      : PipelineStatus.SUCCESS;

  await markPipelineFinished(pipelineId, finalStatus);
  await logStep(
    pipelineId,
    null,
    "info",
    `Pipeline terminé : ${finalStatus}`,
  );

  logger.info({ pipelineId, finalStatus }, "Pipeline terminé");
}