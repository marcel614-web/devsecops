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
      project: true,
      server: true,
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
    },
  });
}

export async function getDeployment(actor: ActorContext, id: string) {
  return loadDeployment(actor, id);
}

function remoteDir(username: string, projectId: string) {
  return `/home/${username}/apps/${projectId}`;
}

function appUrl(serverHost: string) {
  return `http://${serverHost}:${EXTERNAL_PORT}`;
}

export async function startDeployment(actor: ActorContext, id: string) {
  const deployment = await loadDeployment(actor, id);
  const server = deployment.server;
  const project = deployment.project;
  const dir = remoteDir(server.username, project.id);

  const result = await runRemoteCommand(
    server,
    `cd "${dir}" && docker compose up -d --remove-orphans`,
    5 * 60_000,
  );

  if (result.code !== 0) {
    throw new Error(
      `Démarrage échoué (code ${result.code}) : ${result.stderr.slice(0, 300)}`,
    );
  }

  const url = deployment.url ?? appUrl(server.host);
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
  const dir = remoteDir(server.username, project.id);

  const result = await runRemoteCommand(
    server,
    `cd "${dir}" && docker compose stop`,
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
  const dir = remoteDir(server.username, project.id);

  const result = await runRemoteCommand(
    server,
    `cd "${dir}" && docker compose restart`,
    3 * 60_000,
  );

  if (result.code !== 0) {
    throw new Error(
      `Redémarrage échoué (code ${result.code}) : ${result.stderr.slice(0, 300)}`,
    );
  }

  const url = deployment.url ?? appUrl(server.host);
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
  const dir = remoteDir(server.username, project.id);

  await runRemoteCommand(
    server,
    `cd "${dir}" && docker compose down --remove-orphans`,
    5 * 60_000,
  );

  await runRemoteCommand(server, `rm -rf "${dir}"`, 30_000);

  await prisma.deployment.delete({ where: { id } });

  return { success: true };
}