// apps/worker/src/steps/deployment/ports.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";

/**
 * Allocation des ports hôte par projet et par serveur.
 *
 * Plusieurs projets peuvent être déployés sur la même VM. Le port 8080
 * ne peut donc pas être codé en dur : chaque projet reçoit une paire de
 * ports (production + staging) unique sur son serveur. Les ports sont
 * persistés dans ProjectConfiguration afin de rester stables entre les
 * déploiements.
 *
 * Un port explicitement configuré est conservé tant qu'il n'entre pas en
 * conflit avec un autre projet. Sinon, le premier port libre de la plage
 * est attribué automatiquement.
 */

const PORT_MIN = 8080;
const PORT_MAX = 9999;

export interface ProjectPorts {
  productionPort: number;
  stagingPort: number;
}

function extractPort(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/:(\d{2,5})(?:\/|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function findFreePort(used: Set<number>): number {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error(
    `Aucun port disponible dans la plage ${PORT_MIN}-${PORT_MAX} sur ce serveur`,
  );
}

function isRetryableTransactionError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2034"
  );
}

export async function resolveProjectPorts(
  projectId: string,
  serverId: string,
): Promise<ProjectPorts> {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const projects = await tx.project.findMany({
            where: { serverId },
            select: {
              id: true,
              createdAt: true,
              config: {
                select: { stagingPort: true, productionPort: true },
              },
              deployments: {
                select: {
                  url: true,
                  stagingUrl: true,
                  productionUrl: true,
                },
                orderBy: { createdAt: "desc" },
                take: 20,
              },
            },
            orderBy: { createdAt: "asc" },
          });

          const current = projects.find((p) => p.id === projectId);
          if (!current) {
            throw new Error(
              "Projet introuvable pour l'allocation des ports de déploiement",
            );
          }

          // Les ports des autres projets sont réservés, qu'ils soient
          // configurés explicitement ou encore présents dans un ancien
          // déploiement (URL).
          const used = new Set<number>();
          for (const project of projects) {
            if (project.id === projectId) continue;

            if (project.config?.productionPort) {
              used.add(project.config.productionPort);
            }
            if (project.config?.stagingPort) {
              used.add(project.config.stagingPort);
            }

            for (const deployment of project.deployments) {
              for (const url of [
                deployment.productionUrl,
                deployment.stagingUrl,
                deployment.url,
              ]) {
                const port = extractPort(url);
                if (port) used.add(port);
              }
            }
          }

          const desiredProduction = current.config?.productionPort ?? null;
          const desiredStaging = current.config?.stagingPort ?? null;

          // Production d'abord : le premier projet récupère 8080, puis
          // 8082, etc. Staging évite le port de production du projet.
          const productionPort =
            desiredProduction && !used.has(desiredProduction)
              ? desiredProduction
              : findFreePort(used);
          used.add(productionPort);

          const stagingPort =
            desiredStaging && !used.has(desiredStaging)
              ? desiredStaging
              : findFreePort(used);

          await tx.projectConfiguration.update({
            where: { projectId },
            data: { productionPort, stagingPort },
          });

          return { productionPort, stagingPort };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (attempt === maxAttempts || !isRetryableTransactionError(err)) {
        throw err;
      }
      // Conflit de sérialisation : un autre déploiement a alloué un port
      // en même temps. On retente avec l'état à jour.
    }
  }

  throw new Error("Impossible d'allouer les ports de déploiement");
}
