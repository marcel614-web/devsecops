// apps/api/src/modules/github/repositories.service.ts
import { prisma } from "../../utils/prisma";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { getInstallationOctokit } from "./github-app.service";

/**
 * Liste les repositories accessibles à l'utilisateur,
 * agrégés depuis toutes ses installations.
 */
export async function listUserRepositories(
  userId: string,
  filters: {
    installationId?: string;
    search?: string;
    private?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 30, 100);

  const where: Record<string, unknown> = {
    installation: { userId, revokedAt: null },
  };

  if (filters.installationId) {
    where.installationId = filters.installationId;
  }
  if (typeof filters.private === "boolean") {
    where.private = filters.private;
  }
  if (filters.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const skip = (page - 1) * pageSize;

  const [items, total] = await prisma.$transaction([
    prisma.gitHubRepository.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        repositoryId: true,
        fullName: true,
        owner: true,
        name: true,
        private: true,
        defaultBranch: true,
        language: true,
        description: true,
        htmlUrl: true,
        lastSyncedAt: true,
        installation: {
          select: {
            id: true,
            installationId: true,
            accountLogin: true,
            accountType: true,
          },
        },
        _count: { select: { projects: true } },
      },
    }),
    prisma.gitHubRepository.count({ where }),
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Récupère un repository en vérifiant qu'il appartient bien
 * à une installation de l'utilisateur.
 */
export async function getRepositoryForUser(
  userId: string,
  repositoryId: string,
) {
  const repo = await prisma.gitHubRepository.findFirst({
    where: {
      id: repositoryId,
      installation: { userId, revokedAt: null },
    },
    select: {
      id: true,
      repositoryId: true,
      fullName: true,
      owner: true,
      name: true,
      private: true,
      defaultBranch: true,
      language: true,
      description: true,
      htmlUrl: true,
      lastSyncedAt: true,
      installation: {
        select: {
          id: true,
          installationId: true,
          accountLogin: true,
          accountType: true,
        },
      },
    },
  });
  if (!repo) throw new NotFoundError("Repository introuvable");
  return repo;
}

/**
 * Liste les branches d'un repo via l'API GitHub.
 */
export async function listBranches(userId: string, repositoryId: string) {
  const repo = await prisma.gitHubRepository.findFirst({
    where: {
      id: repositoryId,
      installation: { userId, revokedAt: null },
    },
    select: {
      owner: true,
      name: true,
      installation: { select: { installationId: true } },
    },
  });
  if (!repo) throw new NotFoundError("Repository introuvable");

  const octokit = await getInstallationOctokit(repo.installation.installationId);
  const { data } = await octokit.repos.listBranches({
    owner: repo.owner,
    repo: repo.name,
    per_page: 100,
  });

  return data.map((b) => ({
    name: b.name,
    sha: b.commit.sha,
    protected: b.protected,
  }));
}

/**
 * Liste les derniers commits d'une branche.
 */
export async function listCommits(
  userId: string,
  repositoryId: string,
  branch?: string,
) {
  const repo = await prisma.gitHubRepository.findFirst({
    where: {
      id: repositoryId,
      installation: { userId, revokedAt: null },
    },
    select: {
      owner: true,
      name: true,
      defaultBranch: true,
      installation: { select: { installationId: true } },
    },
  });
  if (!repo) throw new NotFoundError("Repository introuvable");

  const octokit = await getInstallationOctokit(repo.installation.installationId);
  const { data } = await octokit.repos.listCommits({
    owner: repo.owner,
    repo: repo.name,
    sha: branch ?? repo.defaultBranch,
    per_page: 20,
  });

  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author?.name ?? "inconnu",
    authorEmail: c.commit.author?.email ?? "",
    date: c.commit.author?.date ?? "",
    htmlUrl: c.html_url,
  }));
}

/**
 * Associe un repository à un projet.
 * Vérifie que :
 *  - le projet appartient à l'utilisateur
 *  - le repository appartient à une installation de l'utilisateur
 */
export async function associateRepositoryToProject(
  userId: string,
  projectId: string,
  repositoryId: string,
  branch: string,
) {
  const [project, repo] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true },
    }),
    prisma.gitHubRepository.findFirst({
      where: {
        id: repositoryId,
        installation: { userId, revokedAt: null },
      },
      select: {
        id: true,
        fullName: true,
        owner: true,
        name: true,
        defaultBranch: true,
        installationId: true,
      },
    }),
  ]);

  if (!project) throw new NotFoundError("Projet introuvable");
  if (project.ownerId !== userId) throw new ForbiddenError("Accès interdit à ce projet");
  if (!repo) throw new NotFoundError("Repository introuvable");

  // Vérifie que la branche existe côté GitHub
  const octokit = await getInstallationOctokit(
    (
      await prisma.gitHubInstallation.findUniqueOrThrow({
        where: { id: repo.installationId },
        select: { installationId: true },
      })
    ).installationId,
  );

  try {
    await octokit.repos.getBranch({
      owner: repo.owner,
      repo: repo.name,
      branch,
    });
  } catch {
    throw new BadRequestError(`La branche "${branch}" n'existe pas sur ce repository`);
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      githubRepositoryId: repo.id,
      monitoredBranch: branch,
      repoFullName: repo.fullName,
      defaultBranch: branch,
    },
    select: {
      id: true,
      githubRepositoryId: true,
      monitoredBranch: true,
      repoFullName: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "PROJECT_REPOSITORY_ASSOCIATED",
      targetType: "Project",
      targetId: projectId,
      metadataJson: { repositoryId: repo.id, fullName: repo.fullName, branch },
    },
  });

  return updated;
}

/**
 * Détache un repository d'un projet.
 */
export async function detachRepositoryFromProject(
  userId: string,
  projectId: string,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new NotFoundError("Projet introuvable");
  if (project.ownerId !== userId) throw new ForbiddenError("Accès interdit à ce projet");

  await prisma.project.update({
    where: { id: projectId },
    data: {
      githubRepositoryId: null,
      monitoredBranch: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "PROJECT_REPOSITORY_DETACHED",
      targetType: "Project",
      targetId: projectId,
    },
  });
}