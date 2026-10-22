// apps/worker/src/orchestrator/pipeline.cleanup.ts
import { DeploymentStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { decryptString } from "../utils/crypto";
import { logger } from "../utils/logger";
import { SshRunner } from "../runners/ssh.runner";
import { logStep } from "./pipeline.logger";

/**
 * Nettoyage des artefacts Docker laissés sur la VM par un pipeline.
 *
 * Constat : jusqu'ici, rien n'était supprimé à la fin d'un pipeline. Chaque
 * build laissait une image `devsecops/<projectId>:<tag>` (~270 Mo) qui
 * s'accumulait indéfiniment, et le cache de build grossissait sans limite.
 * Sur une VM de 20 Go, le disque finissait par saturer (99 %).
 *
 * Principes (fail-safe par construction) :
 *  - la base de données fait foi : une image référencée par un déploiement
 *    VIVANT n'est jamais supprimée ;
 *  - seule l'espace de noms `devsecops/<projectId>:*` est touché (les images
 *    tierces comme `aquasec/trivy`, `anchore/syft` ou `nginx:alpine` sont
 *    laissées intactes) ;
 *  - aucun volume nommé n'est supprimé (en particulier `trivy-cache`, qui
 *    contient la base de vulnérabilités hors-ligne requise par l'étape
 *    « Trivy image ») ;
 *  - le nettoyage ne lève jamais d'exception : un échec de nettoyage ne doit
 *    pas faire échouer un pipeline par ailleurs réussi.
 */

/** Rétention du cache de build Docker sur la VM. Vide = pas d'élagage. */
const BUILD_CACHE_RETENTION = (
  process.env.DOCKER_BUILD_CACHE_RETENTION ?? "24h"
).trim();

/**
 * Nombre d'images conservées par projet.
 *
 * 2 = l'image en production + l'image précédente (cible du rollback).
 * Sans cette borne, les images s'accumulent : chaque build en laisse une
 * (~270 Mo), le disque de la VM saturait à 99 %.
 */
const IMAGE_RETENTION = Math.max(
  1,
  Number.parseInt(process.env.DOCKER_IMAGE_RETENTION ?? "2", 10) || 2,
);

export interface CleanupOptions {
  /** Ne pas démonter le stack de staging. */
  skipStagingTeardown?: boolean;
  /** Ne pas élaguer le cache de build. */
  skipBuildCache?: boolean;
  /** Ne pas supprimer les stacks compose des projets absents de la base. */
  skipOrphanedProjects?: boolean;
}

/**
 * Liste des images à conserver pour un projet.
 *
 * On ne garde que les `IMAGE_RETENTION` déploiements vivants les plus
 * récents : l'image en production et l'image précédente (cible du
 * rollback). Toutes les autres sont considérées comme obsolètes.
 *
 * L'image de rollback du déploiement le plus récent est toujours conservée
 * même si elle sort de la fenêtre de rétention, sinon le mécanisme de
 * retour arrière deployerait une image supprimée.
 */
async function collectLiveImageTags(projectId: string): Promise<Set<string>> {
  const keep = new Set<string>();

  const deployments = await prisma.deployment.findMany({
    where: {
      projectId,
      OR: [
        { status: DeploymentStatus.SUCCESS },
        { stagingStatus: DeploymentStatus.SUCCESS },
        { productionStatus: DeploymentStatus.SUCCESS },
      ],
    },
    select: {
      imageTag: true,
      rollbackImageTag: true,
      status: true,
      stagingStatus: true,
      productionStatus: true,
      finishedAt: true,
      createdAt: true,
    },
    orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });

  // Image de rollback du déploiement le plus récent : à conserver même si
  // elle déborde de la fenêtre de rétention.
  const newest = deployments[0];
  if (newest?.rollbackImageTag) keep.add(newest.rollbackImageTag);

  deployments.slice(0, IMAGE_RETENTION).forEach((deployment) => {
    if (deployment.imageTag) keep.add(deployment.imageTag);
  });

  return keep;
}

/**
 * Indique si le pipeline courant a effectivement promu une image en
 * production. Dans ce cas, le stack de staging a rempli son rôle et peut
 * être démonté.
 */
async function hasProductionDeployment(pipelineId: string): Promise<boolean> {
  const deployment = await prisma.deployment.findUnique({
    where: { pipelineId },
    select: { status: true, productionStatus: true },
  });

  return (
    deployment?.status === DeploymentStatus.SUCCESS ||
    deployment?.productionStatus === DeploymentStatus.SUCCESS
  );
}

/**
 * Démonte le stack de staging (conteneurs + réseau) d'un projet.
 */
async function teardownStaging(
  ssh: SshRunner,
  projectId: string,
  username: string,
): Promise<void> {
  const stagingDir = `/home/${username}/apps/${projectId}/staging`;
  const composeProject = `devsecops-${projectId}-staging`;

  const script = [
    `if [ -f "${stagingDir}/docker-compose.yml" ]; then`,
    `cd "${stagingDir}" && docker compose -p "${composeProject}" down --remove-orphans 2>&1 || true`,
    `else`,
    `docker rm -f $(docker ps -aq --filter "label=com.docker.compose.project=${composeProject}") 2>&1 || true`,
    `fi`,
    `docker network rm "${composeProject}-devsecops" 2>&1 || true`,
  ].join("; ");

  await ssh.exec(script, 180_000);
}

/**
 * Supprime les stacks compose dont le projet n'existe plus en base.
 *
 * Sans ce nettoyage, supprimer un projet (ou un pipeline dont le déploiement
 * a été supprimé en cascade) laissait ses conteneurs et son réseau tourner
 * indéfiniment sur la VM : ils occupaient de l'espace et un port.
 */
async function cleanupOrphanedProjects(
  ssh: SshRunner,
  username: string,
): Promise<string[]> {
  const known = await prisma.project.findMany({
    select: { id: true },
  });
  const knownIds = new Set(known.map((project) => project.id));

  const res = await ssh.exec(
    `docker ps -a --filter "label=com.docker.compose.project" ` +
      `--format '{{.Label "com.docker.compose.project"}}' 2>/dev/null || true`,
    60_000,
  );

  const composeProjects = [
    ...new Set(
      res.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];

  const removed: string[] = [];

  for (const composeProject of composeProjects) {
    const match = /^devsecops-(.+)-(staging|production)$/.exec(composeProject);
    if (!match) continue;

    const projectId = match[1];
    // Le projectId provient des labels Docker : on ne l'utilise dans une
    // commande shell que s'il a une forme strictement alphanumérique.
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) continue;
    if (knownIds.has(projectId)) continue;

    await ssh.exec(
      `docker rm -f $(docker ps -aq --filter "label=com.docker.compose.project=${composeProject}") 2>&1 || true; ` +
        `docker network rm "${composeProject}-devsecops" 2>&1 || true; ` +
        `rm -rf "/home/${username}/apps/${projectId}" 2>&1 || true`,
      120_000,
    );

    removed.push(composeProject);
  }

  return removed;
}

/**
 * Point d'entrée : nettoie les artefacts Docker du projet après la fin
 * d'un pipeline.
 */
export async function cleanupPipelineArtifacts(
  pipelineId: string,
  projectId: string,
  opts: CleanupOptions = {},
): Promise<void> {
  let ssh: SshRunner | null = null;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { server: true },
    });

    const server = project?.server;
    if (!server || !server.encryptedPrivateKey) {
      logger.debug(
        { pipelineId, projectId },
        "Nettoyage ignoré : aucun serveur de déploiement exploitable",
      );
      return;
    }

    const keepImages = await collectLiveImageTags(projectId);
    const productionDeployed = await hasProductionDeployment(pipelineId);

    let privateKey: string;
    try {
      privateKey = decryptString(server.encryptedPrivateKey);
    } catch {
      logger.warn({ pipelineId }, "Nettoyage ignoré : clé SSH illisible");
      return;
    }

    const passphrase = server.encryptedPassphrase
      ? decryptString(server.encryptedPassphrase)
      : undefined;

    ssh = new SshRunner();
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
    });

    // ------------------------------------------------------------
    // 1. Images de la plateforme qui ne sont plus référencées
    // ------------------------------------------------------------
    const listResult = await ssh.exec(
      `docker images --filter "reference=devsecops/${projectId}:*" ` +
        `--format '{{.Repository}}:{{.Tag}}' 2>/dev/null || true`,
      60_000,
    );

    const vmImages = listResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const removable = vmImages.filter((ref) => !keepImages.has(ref));

    for (const ref of removable) {
      // `docker rmi` échoue si l'image est encore utilisée par un conteneur :
      // on ignore l'erreur, l'image est alors conservée.
      const res = await ssh.exec(`docker rmi "${ref}" 2>&1 || true`, 120_000);
      const output = res.stdout.trim();

      if (/^(Error|Conflict)/i.test(output)) {
        await logStep(
          pipelineId,
          null,
          "debug",
          `Image conservée (encore utilisée) : ${ref}`,
        );
      } else {
        await logStep(pipelineId, null, "info", `Image supprimée : ${ref}`);
      }
    }

    // ------------------------------------------------------------
    // 2. Stack de staging démonté une fois la promotion réussie
    // ------------------------------------------------------------
    if (!opts.skipStagingTeardown && productionDeployed) {
      await teardownStaging(ssh, projectId, server.username);
      await logStep(
        pipelineId,
        null,
        "info",
        "Stack de staging démonté (promotion en production réussie)",
      );
    }

    // ------------------------------------------------------------
    // 2bis. Stacks compose des projets supprimés de la base
    // ------------------------------------------------------------
    if (!opts.skipOrphanedProjects) {
      const orphans = await cleanupOrphanedProjects(ssh, server.username);
      for (const orphan of orphans) {
        await logStep(
          pipelineId,
          null,
          "info",
          `Stack orphelin supprimé (projet inexistant en base) : ${orphan}`,
        );
      }
    }

    // ------------------------------------------------------------
    // 3. Cache de build élagué (rétention configurable)
    // ------------------------------------------------------------
    if (!opts.skipBuildCache && BUILD_CACHE_RETENTION) {
      const res = await ssh.exec(
        `docker builder prune -f --filter "until=${BUILD_CACHE_RETENTION}" 2>&1 || true`,
        180_000,
      );

      const match = res.stdout.match(/Total reclaimed space:\s*([^\n]+)/i);
      if (match) {
        await logStep(
          pipelineId,
          null,
          "info",
          `Cache de build élagué (rétention ${BUILD_CACHE_RETENTION}) — espace récupéré : ${match[1].trim()}`,
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ pipelineId, projectId, err: message }, "Nettoyage ignoré");
    await logStep(
      pipelineId,
      null,
      "warn",
      `Nettoyage des artefacts Docker ignoré : ${message}`,
    );
  } finally {
    if (ssh) await ssh.disconnect().catch(() => undefined);
  }
}
