import { DeploymentStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { NotFoundError, ForbiddenError } from "../../utils/errors";
import { runRemoteCommand } from "./ssh.util";

export interface ActorContext {
  id: string;
  role: Role;
}

const EXTERNAL_PORT = 8080;

async function loadDeployment(actor: ActorContext, id: string) {
  const deployment = await prisma.deployment.findUnique({
    where: { id },
    include: {
      project: { include: { config: true } },
      server: true,
      approval: {
        include: {
          decidedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!deployment) throw new NotFoundError("Déploiement introuvable");
  if (actor.role !== Role.ADMIN && deployment.project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce déploiement");
  }
  return deployment;
}

export async function listDeployments(actor: ActorContext) {
  const where =
    actor.role === Role.ADMIN
      ? {}
      : { project: { ownerId: actor.id } };

  return prisma.deployment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      project: { select: { id: true, name: true, technology: true } },
      server: { select: { id: true, name: true, host: true } },
      approval: { select: { id: true, status: true, commitSha: true, imageDigest: true } },
    },
  });
}

/**
 * Liste paginée des déploiements d'un projet.
 *
 * La route `/api/projects/:projectId/deployments` était appelée par le
 * front mais n'existait pas : elle renvoyait 404. On la sert ici avec le
 * même contrôle d'accès que le reste des ressources du projet.
 */
export async function listProjectDeployments(
  actor: ActorContext,
  projectId: string,
  query: { page: number; pageSize: number },
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  if (actor.role !== Role.ADMIN && project.ownerId !== actor.id) {
    throw new ForbiddenError("Accès interdit à ce projet");
  }

  const where: Prisma.DeploymentWhereInput = { projectId };
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.deployment.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { id: true, name: true, technology: true } },
        server: { select: { id: true, name: true, host: true } },
        approval: {
          select: { id: true, status: true, commitSha: true, imageDigest: true },
        },
      },
    }),
    prisma.deployment.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getDeployment(actor: ActorContext, id: string) {
  return loadDeployment(actor, id);
}

function remoteDir(
  username: string,
  projectId: string,
  environment: string,
): string {
  const env = environment === "STAGING" ? "staging" : "production";
  return `/home/${username}/apps/${projectId}/${env}`;
}

function composeProjectName(projectId: string, environment: string): string {
  const env = environment === "STAGING" ? "staging" : "production";
  return `devsecops-${projectId}-${env}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function externalPort(deployment: {
  environment: string;
  project: {
    config: {
      stagingPort: number | null;
      productionPort: number | null;
    } | null;
  };
}): number {
  if (deployment.environment === "STAGING") {
    return deployment.project.config?.stagingPort ?? 8081;
  }
  return deployment.project.config?.productionPort ?? EXTERNAL_PORT;
}

function appUrl(serverHost: string, port: number) {
  return `http://${serverHost}:${port}`;
}

function deploymentUrl(
  deployment: {
    environment: string;
    url: string | null;
    stagingUrl: string | null;
    productionUrl: string | null;
    project: {
      config: {
        stagingPort: number | null;
        productionPort: number | null;
      } | null;
    };
  },
  serverHost: string,
): string {
  const specific =
    deployment.environment === "STAGING"
      ? deployment.stagingUrl
      : deployment.productionUrl;
  return (
    specific ??
    deployment.url ??
    appUrl(serverHost, externalPort(deployment))
  );
}

function composeCommand(
  deployment: {
    environment: string;
    projectId: string;
  },
  args: string,
): string {
  return `docker compose -p "${composeProjectName(
    deployment.projectId,
    deployment.environment,
  )}" ${args}`;
}

export async function startDeployment(actor: ActorContext, id: string) {
  const deployment = await loadDeployment(actor, id);
  const server = deployment.server;
  const project = deployment.project;
  const dir = remoteDir(server.username, project.id, deployment.environment);

  const result = await runRemoteCommand(
    server,
    `cd "${dir}" && ${composeCommand(deployment, "up -d --remove-orphans")}`,
    5 * 60_000,
  );

  if (result.code !== 0) {
    throw new Error(
      `Démarrage échoué (code ${result.code}) : ${result.stderr.slice(0, 300)}`,
    );
  }

  const url = deploymentUrl(deployment, server.host);
  await prisma.deployment.update({
    where: { id },
    data: { status: DeploymentStatus.RUNNING, url },
  });

  // slight wait then mark success if health check passes
  await new Promise((r) => setTimeout(r, 3_000));
  const health = await runRemoteCommand(
    server,
    `curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "${url}/" || echo "FAILED"`,
    20_000,
  );
  const code = health.stdout.trim();
  const ok = code !== "FAILED" && /^[23]/.test(code);

  await prisma.deployment.update({
    where: { id },
    data: { status: ok ? DeploymentStatus.SUCCESS : DeploymentStatus.RUNNING, url },
  });

  return { output: result.stdout + result.stderr, url, status: ok ? "SUCCESS" : "RUNNING" };
}

export async function stopDeployment(actor: ActorContext, id: string) {
  const deployment = await loadDeployment(actor, id);
  const server = deployment.server;
  const project = deployment.project;
  const dir = remoteDir(server.username, project.id, deployment.environment);

  const result = await runRemoteCommand(
    server,
    `cd "${dir}" && ${composeCommand(deployment, "stop")}`,
    3 * 60_000,
  );

  if (result.code !== 0) {
    throw new Error(
      `Arrêt échoué (code ${result.code}) : ${result.stderr.slice(0, 300)}`,
    );
  }

  await prisma.deployment.update({
    where: { id },
    data: { status: DeploymentStatus.CANCELLED },
  });

  return { output: result.stdout + result.stderr };
}

export async function restartDeployment(actor: ActorContext, id: string) {
  const deployment = await loadDeployment(actor, id);
  const server = deployment.server;
  const project = deployment.project;
  const dir = remoteDir(server.username, project.id, deployment.environment);

  const result = await runRemoteCommand(
    server,
    `cd "${dir}" && ${composeCommand(deployment, "restart")}`,
    3 * 60_000,
  );

  if (result.code !== 0) {
    throw new Error(
      `Redémarrage échoué (code ${result.code}) : ${result.stderr.slice(0, 300)}`,
    );
  }

  const url = deploymentUrl(deployment, server.host);
  await prisma.deployment.update({
    where: { id },
    data: { status: DeploymentStatus.SUCCESS, url },
  });

  return { output: result.stdout + result.stderr, url };
}

export async function uninstallDeployment(actor: ActorContext, id: string) {
  const deployment = await loadDeployment(actor, id);
  const server = deployment.server;
  const project = deployment.project;
  const dir = remoteDir(server.username, project.id, deployment.environment);

  await runRemoteCommand(
    server,
    `cd "${dir}" && ${composeCommand(deployment, "down --remove-orphans")}`,
    5 * 60_000,
  );

  await runRemoteCommand(server, `rm -rf "${dir}"`, 30_000);

  await prisma.deployment.delete({ where: { id } });

  return { success: true };
}