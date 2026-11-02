// apps/worker/src/orchestrator/pipeline.engine.ts
import path from "node:path";
import os from "node:os";
import { PipelineStatus, ScanType, StepStatus } from "@prisma/client";
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
import { cleanupPipelineArtifacts } from "./pipeline.cleanup";
import { destroySandbox } from "../isolation/sandbox";
import {
  restoreScanTriage,
  snapshotAndClearScan,
  type TriageSnapshot,
} from "./scan-triage";

const WORKSPACES_ROOT = path.join(os.tmpdir(), "devsecops-workspaces");

/**
 * Une étape de scan peut être reprise après un échec. Dans ce cas, son
 * ancien résultat ne doit pas rester en base : sinon le Security Gate et
 * le rapport final compteraient à la fois l'ancien échec et le nouveau
 * résultat.
 */
const SCAN_TYPE_BY_STEP: Partial<Record<string, ScanType>> = {
  SECRET_SCAN: ScanType.SECRET,
  SAST: ScanType.SAST,
  SCA: ScanType.SCA,
  IAC_SCAN: ScanType.IAC,
  IMAGE_SCAN: ScanType.IMAGE,
  DAST: ScanType.DAST,
};

async function clearPreviousScanResult(
  pipelineId: string,
  step: { id: string; name: string; type: string },
): Promise<TriageSnapshot[]> {
  const scanType = SCAN_TYPE_BY_STEP[step.type];
  if (!scanType) return [];

  // On sauvegarde le triage AVANT la suppression : le deleteMany cascade
  // sur les Vulnerability et détruirait sinon les faux positifs, notes et
  // assignations.
  const snapshots = await snapshotAndClearScan(pipelineId, scanType);

  if (snapshots.length > 0) {
    await logStep(
      pipelineId,
      step.id,
      "info",
      `Reprise : triage sauvegardé pour ${snapshots.length} finding(s) — ancien résultat ${step.name} supprimé`,
    );
  }

  return snapshots;
}

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

async function runPipelineInternal(pipelineId: string): Promise<void> {
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
    await destroySandbox(pipelineId).catch(() => undefined);
    await cleanupPipelineArtifacts(pipelineId, pipeline.project.id);
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

  const firstPending = pipeline.steps.find(
    (step) => step.status !== StepStatus.SUCCESS,
  );
  const hasCompletedSteps = pipeline.steps.some(
    (step) => step.status === StepStatus.SUCCESS,
  );
  if (firstPending && hasCompletedSteps) {
    await logStep(
      pipelineId,
      null,
      "info",
      `Reprise du pipeline à l'étape ${firstPending.order} : ${firstPending.name}`,
    );
  }

  const workspaceDir = path.join(WORKSPACES_ROOT, pipelineId);

  // --- Flags de contrôle ---
  let aborted = false;         // arrêt dû à un échec critique OU à une annulation
  let cancelled = false;       // annulation demandée par l'utilisateur
  let securityBlocked = false; // Security Gate bloqué
  let timedOut = false;        // au moins une étape a dépassé son délai
  let hadWarnings = false;     // gate en WARNING ou étape non critique en échec
  let waitingApproval = false; // promotion en attente d'une décision humaine
  let abortReason: string | null = null;

  try {
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
    // 0bis. Étape déjà réussie avant une reprise : on la conserve telle
    //       quelle et on passe directement à la suivante.
    // ------------------------------------------------------------
    if (step.status === StepStatus.SUCCESS) {
      continue;
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
      await markStepFinished(
        step.id,
        cancelled ? StepStatus.CANCELLED : StepStatus.SKIPPED,
        {
          error: abortReason ?? "Pipeline interrompu",
        },
      );
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
      await markStepFinished(step.id, StepStatus.SKIPPED, {
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
    let triageSnapshot: TriageSnapshot[] = [];
    try {
      // En cas de reprise, on remplace l'ancien résultat de scan de cette
      // étape avant de relancer le scanner. Le triage est sauvegardé pour
      // être réappliqué aux nouveaux findings.
      triageSnapshot = await clearPreviousScanResult(pipelineId, step);
      result = await executeStep(step, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logStep(pipelineId, step.id, "error", `Exception : ${msg}`);
      result = { success: false, exitCode: 1, error: msg };
    }

    // Réapplique le triage (faux positif, assignation, notes…) sur les
    // findings du nouveau scan. Sans cela, une reprise « nettoie » le
    // travail de l'équipe sécurité.
    if (
      result.success &&
      triageSnapshot.length > 0 &&
      SCAN_TYPE_BY_STEP[step.type]
    ) {
      try {
        const restored = await restoreScanTriage(
          pipelineId,
          SCAN_TYPE_BY_STEP[step.type]!,
          triageSnapshot,
        );
        await logStep(
          pipelineId,
          step.id,
          "info",
          `Reprise : triage restauré sur ${restored} finding(s)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await logStep(
          pipelineId,
          step.id,
          "warn",
          `Reprise : impossible de restaurer le triage — ${msg}`,
        );
      }
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
    // 4. Étape interrompue par une annulation (sandbox détruite)
    // ------------------------------------------------------------
    if (result.cancelled === true) {
      cancelled = true;
      aborted = true;
      abortReason = "Annulation demandée par l'utilisateur";
      await markStepFinished(step.id, StepStatus.CANCELLED, {
        exitCode: result.exitCode ?? 130,
        error: result.error ?? "Exécution annulée",
      });
      await logStep(
        pipelineId,
        step.id,
        "warn",
        `Étape annulée : ${step.name}`,
      );
      continue;
    }

    // ------------------------------------------------------------
    // 4bis. Cas spécial : Security Gate a bloqué le déploiement
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
    // 4ter. Attente d'approbation humaine : on arrête le pipeline sans
    //       le considérer comme un échec. Le staging reste en place et la
    //       reprise repartira de cette même étape après décision.
    // ------------------------------------------------------------
    if (result.waitingApproval === true) {
      await markStepFinished(step.id, StepStatus.WAITING_APPROVAL, {
        exitCode: result.exitCode ?? 0,
        error: result.error ?? "Approbation requise",
        resultJson: result.data,
      });
      waitingApproval = true;
      abortReason = result.error ?? "Approbation de production requise";
      await logStep(
        pipelineId,
        step.id,
        "warn",
        `Pipeline en attente d'approbation : ${step.name}`,
      );
      await logStep(
        pipelineId,
        null,
        "info",
        "Aucune promotion ne sera effectuée avant une décision explicite liée à ce commit et à ce digest.",
      );
      break;
    }

    // ------------------------------------------------------------
    // 5. Cas normal : succès (éventuellement avec avertissements)
    // ------------------------------------------------------------
    if (result.success) {
      const gateWarning = result.data?.gate === "WARNING";
      const technicalWarning = result.data?.technical === true;
      // Un scanner indisponible n'est PAS un scan réussi : l'étape est
      // marquée SKIPPED, l'échec technique est conservé dans resultJson et
      // le Security Gate décide ensuite (obligatoire = blocage).
      const technicalSkipped =
        technicalWarning && result.data?.skipped === true;
      if (gateWarning || technicalWarning) hadWarnings = true;
      const stepStatus = technicalSkipped
        ? StepStatus.SKIPPED
        : gateWarning ||
            result.data?.outcome === "SUCCESS_WITH_WARNINGS"
          ? StepStatus.SUCCESS_WITH_WARNINGS
          : StepStatus.SUCCESS;
      await markStepFinished(step.id, stepStatus, {
        exitCode: result.exitCode ?? 0,
        resultJson: result.data
          ? { ...(step.resultJson as object), ...result.data }
          : undefined,
      });
      await logStep(
        pipelineId,
        step.id,
        gateWarning || technicalSkipped ? "warn" : "info",
        technicalSkipped
          ? `Étape sautée pour échec technique : ${step.name}`
          : `Étape ${gateWarning ? "réussie avec avertissements" : "réussie"} : ${step.name}`,
      );
      continue;
    }

    // ------------------------------------------------------------
    // 6. Cas normal : échec ou timeout
    // ------------------------------------------------------------
    const timeoutFailure =
      result.timedOut === true ||
      /timed?\s*out|timeout|délai maximal|deadline/i.test(result.error ?? "");
    if (timeoutFailure) {
      timedOut = true;
      hadWarnings = true;
    }
    await markStepFinished(
      step.id,
      timeoutFailure ? StepStatus.TIMED_OUT : StepStatus.FAILED,
      {
        exitCode: result.exitCode ?? 1,
        error: result.error ?? "Échec",
        resultJson: result.data
          ? { ...(step.resultJson as object), ...result.data }
          : undefined,
      },
    );
    await logStep(
      pipelineId,
      step.id,
      "error",
      `Étape ${timeoutFailure ? "expirée" : "échouée"} : ${step.name} — ${result.error ?? ""}`,
    );

    if (isCritical) {
      aborted = true;
      abortReason = timeoutFailure
        ? `Étape critique expirée : ${step.name}`
        : `Étape critique échouée : ${step.name}`;
      await logStep(
        pipelineId,
        null,
        "error",
        `Pipeline interrompu (étape critique) : ${step.name}`,
      );
    } else if (!timeoutFailure) {
      // Une étape non critique en échec est une exécution partielle : elle
      // ne doit pas être présentée comme un succès total.
      hadWarnings = true;
    }
    }
  } finally {
    // Nettoyage garanti de la sandbox : succès, échec, timeout, annulation
    // ou exception. Le nettoyage est idempotent et ne doit jamais masquer
    // l'issue du pipeline.
    await destroySandbox(pipelineId, (level, message) =>
      logStep(pipelineId, null, level, message),
    ).catch(() => undefined);
  }

  // ------------------------------------------------------------
  // Détermine le statut final
  // ------------------------------------------------------------
  // Priorité des issues : une annulation utilisateur prime toujours, puis un
  // blocage de sécurité. Un dépassement de délai est distingué d'un échec
  // fonctionnel, et une exécution partielle ne doit jamais être présentée
  // comme un succès total.
  const finalStatus = cancelled
    ? PipelineStatus.CANCELLED
    : securityBlocked
      ? PipelineStatus.SECURITY_BLOCKED
      : waitingApproval
        ? PipelineStatus.WAITING_APPROVAL
        : timedOut
          ? PipelineStatus.TIMED_OUT
          : aborted
            ? PipelineStatus.FAILED
            : hadWarnings
              ? PipelineStatus.SUCCESS_WITH_WARNINGS
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

  // ------------------------------------------------------------
  // Nettoyage des artefacts Docker (images obsolètes, cache de build,
  // stack de staging démonté). Sans cette étape, chaque build laissait
  // ~270 Mo d'image sur la VM et le disque saturait.
  // ------------------------------------------------------------
  await cleanupPipelineArtifacts(pipelineId, pipeline.project.id);
}

/**
 * Point d'entrée BullMQ.
 *
 * `runPipelineInternal` ne protège que l'exécution d'une étape
 * (`try/catch` autour de `executeStep`). Une erreur dans le chargement du
 * pipeline, la mise à jour des statuts, le check GitHub ou le nettoyage
 * pouvait laisser le pipeline en RUNNING pour toujours.
 *
 * On ajoute donc une barrière globale : en cas d'exception non gérée, le
 * pipeline est marqué FAILED (s'il était encore actif), un log est écrit et
 * les artefacts sont nettoyés. L'erreur est ensuite relancée pour que
 * BullMQ marque le job comme failed.
 */
export async function runPipeline(pipelineId: string): Promise<void> {
  try {
    await runPipelineInternal(pipelineId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { pipelineId, err: message },
      "Pipeline interrompu par une exception non gérée",
    );

    try {
      const current = await prisma.pipeline.findUnique({
        where: { id: pipelineId },
        select: { status: true, projectId: true },
      });

      if (!current) {
        throw err;
      }

      if (
        current.status === PipelineStatus.QUEUED ||
        current.status === PipelineStatus.RUNNING
      ) {
        await logStep(
          pipelineId,
          null,
          "error",
          `Erreur interne non gérée : ${message}`,
        );
        await markPipelineFinished(pipelineId, PipelineStatus.FAILED);
      }

      await clearPipelineCancellation(pipelineId);
      await destroySandbox(pipelineId).catch(() => undefined);
      await cleanupPipelineArtifacts(pipelineId, current.projectId);
    } catch (cleanupErr) {
      logger.error(
        {
          pipelineId,
          err:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        },
        "Impossible de finaliser/nettoyer le pipeline après l'erreur",
      );
    }

    throw err;
  }
}