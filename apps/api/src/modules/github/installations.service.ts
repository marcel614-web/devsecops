// apps/api/src/modules/github/installations.service.ts
import { prisma } from "../../utils/prisma";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import {
  fetchInstallation,
  getInstallationOctokit,
  invalidateInstallationToken,
} from "./github-app.service";
import { logger } from "../../utils/logger";

interface SyncInstallationInput {
  userId: string;
  installationId: string;
}

/**
 * Extrait un login lisible depuis l'objet account GitHub.
 * GitHub renvoie soit un User (avec `login`), soit une Organization
 * (avec `name` et `slug`).
 */
function extractAccountLogin(account: unknown, installationId: string): string {
  if (account && typeof account === "object") {
    const obj = account as Record<string, unknown>;
    if (typeof obj.login === "string") return obj.login;
    if (typeof obj.name === "string") return obj.name;
    if (typeof obj.slug === "string") return obj.slug;
  }
  return `installation-${installationId}`;
}

function extractAccountId(account: unknown): string {
  if (account && typeof account === "object") {
    const obj = account as Record<string, unknown>;
    if (typeof obj.id === "number" || typeof obj.id === "string") {
      return String(obj.id);
    }
  }
  return "unknown";
}

/**
 * Synchronise une installation : la crée ou la met à jour,
 * puis importe la liste des repositories accessibles.
 */
export async function syncInstallation({
  userId,
  installationId,
}: SyncInstallationInput) {
  // 1. Vérifie côté GitHub que l'installation existe et est accessible
  const ghInstall = await fetchInstallation(installationId);

  const accountLogin = extractAccountLogin(
    ghInstall.account,
    installationId,
  );
  const accountId = extractAccountId(ghInstall.account);
  const accountType = ghInstall.target_type ?? "User";

  // 2. Upsert de l'installation
  const installation = await prisma.gitHubInstallation.upsert({
    where: { installationId },
    create: {
      installationId,
      accountLogin,
      accountType,
      accountId,
      targetType: accountType,
      userId,
      suspendedAt: ghInstall.suspended_at
        ? new Date(ghInstall.suspended_at)
        : null,
      revokedAt: null,
    },
    update: {
      accountLogin,
      accountType,
      accountId,
      targetType: accountType,
      userId,
      suspendedAt: ghInstall.suspended_at
        ? new Date(ghInstall.suspended_at)
        : null,
      revokedAt: null,
    },
    select: {
      id: true,
      installationId: true,
      accountLogin: true,
      accountType: true,
    },
  });

  // 3. Import des repositories
  await syncRepositories(installation.installationId);

  // 4. Audit
  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_APP_INSTALLED",
      targetType: "GitHubInstallation",
      targetId: installation.id,
      metadataJson: { accountLogin, accountType },
    },
  });

  logger.info(
    { userId, installationId, accountLogin },
    "Installation GitHub synchronisée",
  );

  return installation;
}

/**
 * Synchronise la liste des repositories d'une installation.
 */
export async function syncRepositories(installationId: string) {
  const octokit = await getInstallationOctokit(installationId);

  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId },
    select: { id: true },
  });
  if (!installation) {
    throw new NotFoundError("Installation inconnue");
  }

  type RepoItem = {
    id: number;
    full_name: string;
    owner: { login: string } | null;
    name: string;
    private: boolean;
    default_branch: string;
    language: string | null;
    description: string | null;
    html_url: string;
  };

  const repos: RepoItem[] = [];
  let page = 1;

  while (page <= 5) {
    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: 100,
      page,
    });

    const items = data.repositories as unknown as RepoItem[];
    if (items.length === 0) break;
    repos.push(...items);
    if (items.length < 100) break;
    page++;
  }

  for (const repo of repos) {
    const ownerLogin = repo.owner?.login ?? "";
    await prisma.gitHubRepository.upsert({
      where: {
        installationId_repositoryId: {
          installationId: installation.id,
          repositoryId: String(repo.id),
        },
      },
      create: {
        installationId: installation.id,
        repositoryId: String(repo.id),
        fullName: repo.full_name,
        owner: ownerLogin,
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        language: repo.language,
        description: repo.description,
        htmlUrl: repo.html_url,
        lastSyncedAt: new Date(),
      },
      update: {
        fullName: repo.full_name,
        owner: ownerLogin,
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        language: repo.language,
        description: repo.description,
        htmlUrl: repo.html_url,
        lastSyncedAt: new Date(),
      },
    });
  }

  // Supprime les repos qui ne sont plus accessibles (mais pas ceux liés à un projet)
  const currentIds = repos.map((r) => String(r.id));
  await prisma.gitHubRepository.deleteMany({
    where: {
      installationId: installation.id,
      repositoryId: { notIn: currentIds },
      projects: { none: {} },
    },
  });

  logger.debug(
    { installationId, count: repos.length },
    "Repositories synchronisés",
  );

  return repos.length;
}

/**
 * Liste les installations d'un utilisateur.
 */
export async function listInstallations(userId: string) {
  return prisma.gitHubInstallation.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      installationId: true,
      accountLogin: true,
      accountType: true,
      suspendedAt: true,
      createdAt: true,
      _count: { select: { repositories: true } },
    },
  });
}

/**
 * Supprime une installation.
 */
export async function revokeInstallation(userId: string, installationId: string) {
  const installation = await prisma.gitHubInstallation.findFirst({
    where: { installationId, userId },
    select: { id: true, installationId: true, accountLogin: true },
  });
  if (!installation) throw new NotFoundError("Installation introuvable");

  const usedCount = await prisma.project.count({
    where: {
      githubRepository: { installationId: installation.id },
    },
  });
  if (usedCount > 0) {
    throw new BadRequestError(
      `Cette installation est utilisée par ${usedCount} projet(s). Détachez-les avant de la révoquer.`,
    );
  }

  await prisma.gitHubInstallation.delete({
    where: { id: installation.id },
  });

  invalidateInstallationToken(installationId);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_APP_REVOKED",
      targetType: "GitHubInstallation",
      targetId: installation.id,
      metadataJson: { accountLogin: installation.accountLogin },
    },
  });
}

/**
 * Handler des webhooks installation / installation_repositories.
 */
export async function handleInstallationEvent(event: {
  action: string;
  installation: {
    id: number;
    account: unknown;
    suspended_at?: string | null;
  };
}) {
  const installationId = String(event.installation.id);
  const accountLogin = extractAccountLogin(
    event.installation.account,
    installationId,
  );

  switch (event.action) {
    case "created":
    case "new_permissions_accepted": {
      logger.info(
        { installationId, accountLogin },
        "Installation GitHub créée via webhook",
      );
      return;
    }

    case "deleted": {
      const inst = await prisma.gitHubInstallation.findUnique({
        where: { installationId },
        select: { id: true, userId: true },
      });
      if (inst) {
        await prisma.gitHubInstallation.update({
          where: { id: inst.id },
          data: { revokedAt: new Date() },
        });
        await prisma.project.updateMany({
          where: { githubRepository: { installationId: inst.id } },
          data: { githubRepositoryId: null, monitoredBranch: null },
        });
        invalidateInstallationToken(installationId);
        logger.warn(
          { installationId, accountLogin },
          "Installation GitHub supprimée",
        );
      }
      return;
    }

    case "suspend": {
      await prisma.gitHubInstallation.updateMany({
        where: { installationId },
        data: { suspendedAt: new Date() },
      });
      invalidateInstallationToken(installationId);
      logger.warn({ installationId }, "Installation GitHub suspendue");
      return;
    }

    case "unsuspend": {
      await prisma.gitHubInstallation.updateMany({
        where: { installationId },
        data: { suspendedAt: null },
      });
      logger.info({ installationId }, "Installation GitHub réactivée");
      return;
    }

    default:
      logger.debug({ action: event.action }, "Événement installation ignoré");
  }
}