// apps/worker/src/steps/deployment/deployment.lock.ts
import { PipelineStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";

/**
 * Verrou de déploiement par projet.
 *
 * Deux pipelines ne doivent jamais piloter simultanément les conteneurs du
 * même projet : le second écraserait le premier sans que l'historique ne
 * permette de savoir quelle version est réellement en production.
 *
 * Le verrou est un enregistrement unique par projet. Il est libéré dans le
 * `finally` de l'étape ; une expiration de secours couvre le cas où le
 * worker meurt brutalement.
 */
const LOCK_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.DEPLOYMENT_LOCK_TTL_MS ?? "", 10) ||
    2 * 60 * 60_000,
);

export interface DeploymentLockHandle {
  projectId: string;
  pipelineId: string;
  environment: string;
  expiresAt: Date;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export async function acquireDeploymentLock(
  projectId: string,
  pipelineId: string,
  environment: string,
): Promise<DeploymentLockHandle> {
  const now = new Date();

  // Purge des verrous expirés (worker arrêté, VM redémarrée…).
  await prisma.deploymentLock.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  try {
    const lock = await prisma.deploymentLock.create({
      data: { projectId, pipelineId, environment, acquiredAt: now, expiresAt },
      select: {
        projectId: true,
        pipelineId: true,
        environment: true,
        expiresAt: true,
      },
    });
    return lock;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const holder = await prisma.deploymentLock.findUnique({
      where: { projectId },
      select: { pipelineId: true, environment: true, acquiredAt: true },
    });

    throw new Error(
      `Déploiement concurrent refusé : le projet est déjà verrouillé par ` +
        `le pipeline ${holder?.pipelineId ?? "inconnu"} ` +
        `(${holder?.environment ?? "environnement inconnu"}, ` +
        `depuis ${holder?.acquiredAt?.toISOString() ?? "date inconnue"}).`,
    );
  }
}

/** Ne libère que le verrou appartenant à ce pipeline. */
export async function releaseDeploymentLock(
  projectId: string,
  pipelineId: string,
): Promise<void> {
  await prisma.deploymentLock.deleteMany({
    where: { projectId, pipelineId },
  });
}

/**
 * Refuse de déployer une exécution devenue obsolète : un commit plus récent
 * a déclenché un pipeline encore actif sur la même branche. L'ancien
 * pipeline ne doit pas écraser la production après coup.
 */
export async function assertPipelineIsCurrent(pipelineId: string): Promise<void> {
  const current = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: {
      id: true,
      projectId: true,
      branch: true,
      commitSha: true,
      createdAt: true,
    },
  });
  if (!current) throw new Error("Pipeline introuvable");

  const newer = await prisma.pipeline.findFirst({
    where: {
      projectId: current.projectId,
      branch: current.branch,
      // Un autre pipeline sur le MÊME commit (relance manuelle) ne rend pas
      // l'artefact obsolète : c'est exactement le même digest.
      commitSha: { not: current.commitSha },
      id: { not: pipelineId },
      createdAt: { gt: current.createdAt },
      status: {
        in: [
          PipelineStatus.QUEUED,
          PipelineStatus.RUNNING,
          PipelineStatus.WAITING_APPROVAL,
          // Un commit plus récent déjà déployé ne doit jamais être écrasé
          // par la promotion tardive d'un commit antérieur.
          PipelineStatus.SUCCESS,
          PipelineStatus.SUCCESS_WITH_WARNINGS,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, commitSha: true, createdAt: true },
  });

  if (newer) {
    throw new Error(
      `Pipeline obsolète : un commit plus récent (${newer.commitSha.slice(0, 12)}) ` +
        `est déjà en cours dans le pipeline ${newer.id}. ` +
        "Déploiement refusé pour ne pas remplacer la version en cours de validation.",
    );
  }
}
