// apps/api/src/modules/github/team-repos.service.ts
import type { Octokit } from "@octokit/rest";
import { prisma } from "../../utils/prisma";
import { BadRequestError } from "../../utils/errors";
import {
  capabilitiesFor,
  loadInstallation,
} from "./teams.service";
import { getInstallationOctokit } from "./github-app.service";
import {
  permissionRequiredError,
  toGitHubAppError,
} from "./github-api-error";

export type TeamRepoPermission =
  | "pull"
  | "triage"
  | "push"
  | "maintain"
  | "admin";

interface GitHubRepoPayload {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  html_url: string;
  description?: string | null;
}

async function checkRepoPermission(
  octokit: Octokit,
  org: string,
  slug: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.teams.checkPermissionsForRepoInOrg({
      org,
      team_slug: slug,
      owner,
      repo,
    });
    return (data as { permission?: string }).permission ?? null;
  } catch {
    return null;
  }
}

export async function listTeamRepos(
  userId: string,
  installationId: string,
  slug: string,
  filters: { page: number; pageSize: number },
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canReadTeams) {
    throw permissionRequiredError(
      "Affichage des dépôts associés",
      capabilities.missingPermissions,
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  let repos: GitHubRepoPayload[];
  try {
    const { data } = await octokit.teams.listReposInOrg({
      org: installation.accountLogin,
      team_slug: slug,
      per_page: filters.pageSize,
      page: filters.page,
    });
    repos = data as unknown as GitHubRepoPayload[];
  } catch (err) {
    throw toGitHubAppError(
      err,
      "Récupération des dépôts associés à l'équipe",
    );
  }

  const items = await Promise.all(
    repos.map(async (repo) => {
      const permission = await checkRepoPermission(
        octokit,
        installation.accountLogin,
        slug,
        repo.owner.login,
        repo.name,
      );
      return {
        id: String(repo.id),
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.owner.login,
        private: repo.private,
        htmlUrl: repo.html_url,
        description: repo.description ?? null,
        permission,
      };
    }),
  );

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    hasNext: repos.length === filters.pageSize,
    capabilities,
    organization: installation.accountLogin,
  };
}

export async function listAvailableRepos(
  userId: string,
  installationId: string,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canReadTeams) {
    throw permissionRequiredError(
      "Affichage des dépôts de l'organisation",
      capabilities.missingPermissions,
    );
  }

  const repos = await prisma.gitHubRepository.findMany({
    where: {
      installationId: installation.id,
      owner: { equals: installation.accountLogin, mode: "insensitive" },
    },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      repositoryId: true,
      fullName: true,
      name: true,
      owner: true,
      private: true,
      htmlUrl: true,
      description: true,
    },
  });

  return { items: repos, organization: installation.accountLogin };
}

export async function setRepoPermission(
  userId: string,
  installationId: string,
  slug: string,
  input: {
    owner: string;
    repo: string;
    permission: TeamRepoPermission;
  },
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canManageRepoPermissions) {
    throw permissionRequiredError(
      "Modification de la permission d'un dépôt",
      ["Administration: write"],
    );
  }

  if (
    input.owner.toLowerCase() !== installation.accountLogin.toLowerCase()
  ) {
    throw new BadRequestError(
      `Le dépôt doit appartenir à l'organisation ${installation.accountLogin}.`,
    );
  }

  const knownRepo = await prisma.gitHubRepository.findFirst({
    where: {
      installationId: installation.id,
      owner: { equals: input.owner, mode: "insensitive" },
      name: input.repo,
    },
    select: { id: true, fullName: true },
  });
  if (!knownRepo) {
    throw new BadRequestError(
      `Le dépôt ${input.owner}/${input.repo} n'est pas accessible à cette installation GitHub.`,
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  try {
    await octokit.teams.addOrUpdateRepoPermissionsInOrg({
      org: installation.accountLogin,
      team_slug: slug,
      owner: input.owner,
      repo: input.repo,
      permission: input.permission,
    });
  } catch (err) {
    throw toGitHubAppError(
      err,
      `Association du dépôt ${input.owner}/${input.repo} à l'équipe`,
    );
  }

  const verified = await checkRepoPermission(
    octokit,
    installation.accountLogin,
    slug,
    input.owner,
    input.repo,
  );

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_TEAM_REPO_PERMISSION_SET",
      targetType: "GitHubTeam",
      targetId: `${installation.accountLogin}/${slug}`,
      metadataJson: {
        repository: `${input.owner}/${input.repo}`,
        permission: input.permission,
        verifiedPermission: verified,
      },
    },
  });

  return {
    repository: `${input.owner}/${input.repo}`,
    permission: verified ?? input.permission,
    verified: verified !== null,
  };
}

export async function removeTeamRepo(
  userId: string,
  installationId: string,
  slug: string,
  owner: string,
  repo: string,
) {
  const installation = await loadInstallation(userId, installationId);
  const { capabilities } = await capabilitiesFor(installation.installationId);

  if (!capabilities.canManageRepoPermissions) {
    throw permissionRequiredError(
      "Retrait d'un dépôt de l'équipe",
      ["Administration: write"],
    );
  }

  const octokit = await getInstallationOctokit(installation.installationId);

  try {
    await octokit.teams.removeRepoInOrg({
      org: installation.accountLogin,
      team_slug: slug,
      owner,
      repo,
    });
  } catch (err) {
    throw toGitHubAppError(
      err,
      `Retrait du dépôt ${owner}/${repo} de l'équipe`,
    );
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "GITHUB_TEAM_REPO_REMOVED",
      targetType: "GitHubTeam",
      targetId: `${installation.accountLogin}/${slug}`,
      metadataJson: { repository: `${owner}/${repo}` },
    },
  });

  return { repository: `${owner}/${repo}`, removed: true };
}
