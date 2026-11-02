// apps/api/src/modules/servers/servers.service.ts
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { encryptString, fingerprint } from "../../secrets/crypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import type {
  CreateServerInput,
  ServerListQuery,
  UpdateServerInput,
} from "./servers.schema";
import { runRemoteCommand } from "../deployments/ssh.util";
import {
  collectServerResources,
  type ServerResources,
} from "./server-resources.service";

export interface ActorContext {
  id: string;
  role: Role;
}

/**
 * Champs exposés au client. JAMAIS encryptedPrivateKey ni encryptedPassphrase.
 */
const PUBLIC_SELECT = {
  id: true,
  ownerId: true,
  name: true,
  host: true,
  sshPort: true,
  username: true,
  authType: true,
  hostKeyFingerprint: true,
  hostKeyAlgorithm: true,
  hostKeyTrustedAt: true,
  status: true,
  lastCheckedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DeploymentServerSelect;

async function ensureServerAccess(
  actor: ActorContext,
  serverId: string,
): Promise<{ id: string; ownerId: string }> {
  const server = await prisma.deploymentServer.findUnique({
    where: { id: serverId },
    select: { id: true, ownerId: true },
  });
  if (!server) throw new NotFoundError("Serveur introuvable");

  if (actor.role === Role.ADMIN) return server;
  if (server.ownerId === actor.id) return server;
  const owner = await prisma.user.findUnique({
    where: { id: server.ownerId },
    select: { role: true },
  });
  if (owner?.role === Role.ADMIN) return server;
  throw new ForbiddenError("Accès interdit à ce serveur");
}

export async function listServers(actor: ActorContext, query: ServerListQuery) {
  const where: Prisma.DeploymentServerWhereInput = {};

  const conditions: Prisma.DeploymentServerWhereInput[] = [];

  if (actor.role !== Role.ADMIN) {
    conditions.push({
      OR: [{ ownerId: actor.id }, { owner: { role: Role.ADMIN } }],
    });
  }

  if (query.search) {
    conditions.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { host: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }

  if (conditions.length > 0) {
    where.AND = conditions;
  }

  const skip = (query.page - 1) * query.pageSize;

  const [rows, total] = await prisma.$transaction([
    prisma.deploymentServer.findMany({
      where,
      // La clé chiffrée n'est jamais renvoyée au client : on ne garde que
      // le booléen hasPrivateKey dans la réponse.
      select: { ...PUBLIC_SELECT, encryptedPrivateKey: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.deploymentServer.count({ where }),
  ]);

  const items = rows.map(({ encryptedPrivateKey, ...server }) => ({
    ...server,
    hasPrivateKey: !!encryptedPrivateKey,
  }));

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getServer(actor: ActorContext, serverId: string) {
  await ensureServerAccess(actor, serverId);

  const server = await prisma.deploymentServer.findUnique({
    where: { id: serverId },
    select: {
      ...PUBLIC_SELECT,
      // On ne renvoie jamais la clé. On expose juste "présence" + empreinte.
      encryptedPrivateKey: true,
      _count: { select: { projects: true, deployments: true } },
    },
  });
  if (!server) throw new NotFoundError("Serveur introuvable");

  const { encryptedPrivateKey, ...rest } = server;

  return {
    ...rest,
    hasPrivateKey: !!encryptedPrivateKey,
  };
}

export async function createServer(actor: ActorContext, input: CreateServerInput) {
  // Unicité par (ownerId, name).
  const existing = await prisma.deploymentServer.findUnique({
    where: {
      ownerId_name: { ownerId: actor.id, name: input.name },
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Vous avez déjà un serveur avec ce nom");
  }

  const encryptedPrivateKey = input.privateKey
    ? encryptString(input.privateKey)
    : null;
  const encryptedPassphrase = input.passphrase
    ? encryptString(input.passphrase)
    : null;

  const server = await prisma.deploymentServer.create({
    data: {
      ownerId: actor.id,
      name: input.name,
      host: input.host,
      sshPort: input.sshPort,
      username: input.username,
      authType: input.authType,
      encryptedPrivateKey,
      encryptedPassphrase,
      hostKeyFingerprint: input.hostKeyFingerprint ?? null,
      hostKeyAlgorithm: input.hostKeyAlgorithm ?? null,
      hostKeyTrustedAt: input.hostKeyFingerprint ? new Date() : null,
      status: "unknown",
    },
    select: PUBLIC_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SERVER_CREATED",
      targetType: "DeploymentServer",
      targetId: server.id,
      metadataJson: {
        host: server.host,
        port: server.sshPort,
        username: server.username,
        hasPrivateKey: !!encryptedPrivateKey,
        keyFingerprint: input.privateKey ? fingerprint(input.privateKey) : null,
        hostKeyFingerprint: input.hostKeyFingerprint ?? null,
      },
    },
  });

  return server;
}

export async function updateServer(
  actor: ActorContext,
  serverId: string,
  input: UpdateServerInput,
) {
  await ensureServerAccess(actor, serverId);

  // Unicité du nouveau nom si renommé.
  if (input.name) {
    const dup = await prisma.deploymentServer.findUnique({
      where: {
        ownerId_name: { ownerId: actor.id, name: input.name },
      },
      select: { id: true },
    });
    if (dup && dup.id !== serverId) {
      throw new ConflictError("Un autre serveur porte déjà ce nom");
    }
  }

  const data: Prisma.DeploymentServerUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.host !== undefined) data.host = input.host;
  if (input.sshPort !== undefined) data.sshPort = input.sshPort;
  if (input.username !== undefined) data.username = input.username;
  if (input.privateKey !== undefined) {
    data.encryptedPrivateKey = encryptString(input.privateKey);
  }
  if (input.passphrase !== undefined) {
    data.encryptedPassphrase = encryptString(input.passphrase);
  }
  if (input.hostKeyFingerprint !== undefined) {
    data.hostKeyFingerprint = input.hostKeyFingerprint;
    data.hostKeyAlgorithm = input.hostKeyAlgorithm ?? null;
    data.hostKeyTrustedAt = new Date();
  }

  // Toute modification des paramètres de connexion invalide le dernier test.
  const connectionChanged =
    input.host !== undefined ||
    input.sshPort !== undefined ||
    input.username !== undefined ||
    input.privateKey !== undefined ||
    input.passphrase !== undefined;
  if (connectionChanged) {
    data.status = "unknown";
    data.lastCheckedAt = null;
  }

  // Une empreinte est liée à un hôte et un port précis : on ne la conserve
  // jamais après un changement de destination, même si le client fournit une
  // empreinte dans la même requête. L'utilisateur doit repasser par l'action
  // explicite de confiance après avoir vérifié la nouvelle clé.
  if (input.host !== undefined || input.sshPort !== undefined) {
    data.hostKeyFingerprint = null;
    data.hostKeyAlgorithm = null;
    data.hostKeyTrustedAt = null;
  }

  const updated = await prisma.deploymentServer.update({
    where: { id: serverId },
    data,
    select: PUBLIC_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SERVER_UPDATED",
      targetType: "DeploymentServer",
      targetId: serverId,
      metadataJson: {
        fields: Object.keys(input),
        connectionReset: connectionChanged,
        newKeyFingerprint: input.privateKey ? fingerprint(input.privateKey) : null,
        hostKeyFingerprint: input.hostKeyFingerprint ?? null,
      },
    },
  });

  return updated;
}

export async function deleteServer(actor: ActorContext, serverId: string) {
  await ensureServerAccess(actor, serverId);

  // Refus si le serveur est utilisé par un projet : on protège l'utilisateur.
  const projectCount = await prisma.project.count({
    where: { serverId },
  });
  if (projectCount > 0) {
    throw new ConflictError(
      `Ce serveur est utilisé par ${projectCount} projet(s). Détachez-le d'abord.`,
    );
  }

  await prisma.deploymentServer.delete({ where: { id: serverId } });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SERVER_DELETED",
      targetType: "DeploymentServer",
      targetId: serverId,
    },
  });
}

/**
 * Retourne la clé privée déchiffrée pour un usage interne (worker SSH).
 * Ne JAMAIS exposer cette fonction via une route HTTP publique.
 */
export async function getServerPrivateKeyInternal(serverId: string): Promise<{
  privateKey: string | null;
  passphrase: string | null;
}> {
  const server = await prisma.deploymentServer.findUnique({
    where: { id: serverId },
    select: { encryptedPrivateKey: true, encryptedPassphrase: true },
  });
  if (!server) throw new NotFoundError("Serveur introuvable");

  const { decryptString } = await import("../../secrets/crypto");
  return {
    privateKey: server.encryptedPrivateKey
      ? decryptString(server.encryptedPrivateKey)
      : null,
    passphrase: server.encryptedPassphrase
      ? decryptString(server.encryptedPassphrase)
      : null,
  };
}

// apps/api/src/modules/servers/servers.service.ts (ajout à la fin)

import { testServerConnection, type ServerTestResult } from "./ssh-tester.service";

/**
 * Teste la connexion SSH + vérifie Docker / Docker Compose / Nginx.
 * Met à jour le status du serveur en base (ok / failed).
 */
export async function testServer(
  actor: ActorContext,
  serverId: string,
): Promise<{
  result: ServerTestResult;
  status: string;
  lastCheckedAt: Date;
}> {
  await ensureServerAccess(actor, serverId);

  const server = await prisma.deploymentServer.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      host: true,
      sshPort: true,
      username: true,
      encryptedPrivateKey: true,
      encryptedPassphrase: true,
      hostKeyFingerprint: true,
    },
  });
  if (!server) throw new NotFoundError("Serveur introuvable");

  const result = await testServerConnection({
    host: server.host,
    sshPort: server.sshPort,
    username: server.username,
    encryptedPrivateKey: server.encryptedPrivateKey,
    encryptedPassphrase: server.encryptedPassphrase,
    hostKeyFingerprint: server.hostKeyFingerprint,
  });

  // Statut global : "ok" seulement si SSH + Docker OK
  const globalStatus = result.ssh.ok && result.docker.ok ? "ok" : "failed";

  const now = new Date();
  await prisma.deploymentServer.update({
    where: { id: serverId },
    data: {
      status: globalStatus,
      lastCheckedAt: now,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SERVER_TESTED",
      targetType: "DeploymentServer",
      targetId: serverId,
      metadataJson: {
        status: globalStatus,
        ssh: result.ssh.ok,
        docker: result.docker.ok,
        dockerCompose: result.dockerCompose.ok,
        nginx: result.nginx.ok,
        hostKeyObserved: result.hostKey.observedFingerprint,
        hostKeyTrusted: result.hostKey.trusted,
      },
    },
  });

  return {
    result,
    status: globalStatus,
    lastCheckedAt: now,
  };
}

export async function cleanupDockerImages(actor: ActorContext, serverId: string) {
  await ensureServerAccess(actor, serverId);

  const server = await prisma.deploymentServer.findUnique({
    where: { id: serverId },
  });
  if (!server) throw new NotFoundError("Serveur introuvable");

  const output = await runRemoteCommand(
    server,
    "docker image prune -af --filter 'label=devsecops.pipeline'",
    5 * 60_000,
  );

  if (output.code !== 0) {
    throw new Error(`Nettoyage �chou� (code ${output.code}) : ${output.stderr.slice(0, 300)}`);
  }

  return { output: output.stdout + output.stderr };
}

/**
 * Relève les ressources système du serveur via SSH : CPU, mémoire, disque,
 * uptime et état des conteneurs Docker. Aucune donnée n'est persistée.
 */
export async function getServerResources(
  actor: ActorContext,
  serverId: string,
): Promise<ServerResources> {
  await ensureServerAccess(actor, serverId);

  const server = await prisma.deploymentServer.findUnique({
    where: { id: serverId },
    select: {
      host: true,
      sshPort: true,
      username: true,
      encryptedPrivateKey: true,
      encryptedPassphrase: true,
      hostKeyFingerprint: true,
    },
  });
  if (!server) throw new NotFoundError("Serveur introuvable");

  return collectServerResources(server);
}

/**
 * Enregistre explicitement la référence de confiance de la clé d'hôte.
 * L'empreinte doit provenir d'un test affiché à l'utilisateur et confirmé
 * hors bande ; aucun déploiement n'utilise une connexion sans référence.
 */
export async function trustServerHostKey(
  actor: ActorContext,
  serverId: string,
  input: { fingerprint: string; algorithm?: string },
) {
  await ensureServerAccess(actor, serverId);

  const updated = await prisma.deploymentServer.update({
    where: { id: serverId },
    data: {
      hostKeyFingerprint: input.fingerprint,
      hostKeyAlgorithm: input.algorithm ?? null,
      hostKeyTrustedAt: new Date(),
      status: "unknown",
      lastCheckedAt: null,
    },
    select: PUBLIC_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: "SERVER_HOST_KEY_TRUSTED",
      targetType: "DeploymentServer",
      targetId: serverId,
      metadataJson: {
        hostKeyFingerprint: input.fingerprint,
        hostKeyAlgorithm: input.algorithm ?? null,
      },
    },
  });

  return updated;
}
