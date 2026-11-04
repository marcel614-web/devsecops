// apps/web/src/services/github.service.ts
import { api } from "./api";

export interface GitHubInstallation {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  suspendedAt: string | null;
  createdAt: string;
  _count?: { repositories: number };
}

export interface GitHubRepository {
  id: string;
  repositoryId: string;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  language: string | null;
  description: string | null;
  htmlUrl: string;
  lastSyncedAt: string;
  installation: {
    id: string;
    installationId: string;
    accountLogin: string;
    accountType: string;
  };
  _count?: { projects: number };
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  htmlUrl: string;
}

export interface BranchProtectionReport {
  repository: string;
  branch: string;
  observedAt: string;
  verifiable: boolean;
  reason: string | null;
  protectionEnabled: boolean | null;
  rulesets: Array<{ id: number; name: string; enforcement: string }>;
  rulesetsEnabled: boolean | null;
  requiredStatusChecks: string[];
  checkName: string;
  devSecOpsCheckRequired: boolean | null;
  strictUpToDate: boolean | null;
  enforceAdmins: boolean | null;
  requiredPermissions: string[];
  appPermissions: Record<string, string>;
  missingPermissions: string[];
  correctiveSteps: string[];
  note: string;
}

export interface GitHubTeamCapabilities {
  canReadTeams: boolean;
  canWriteTeams: boolean;
  canManageRepoPermissions: boolean;
  appPermissions: Record<string, string>;
  missingPermissions: string[];
  requiredPermissions: string[];
}

export interface GitHubOrganization {
  id: string;
  installationId: string;
  login: string;
  githubOrgId: string;
  htmlUrl: string;
  avatarUrl: string | null;
  description: string | null;
  suspendedAt: string | null;
  lastOrgSyncedAt: string | null;
  orgSyncState: string | null;
  repositoryCount: number;
  teamCount: number;
  createdAt: string;
  capabilities: GitHubTeamCapabilities;
  error: string | null;
}

export type GitHubTeamPrivacy = "secret" | "closed";

export interface GitHubTeam {
  id: string;
  githubTeamId: string;
  installationId: string;
  orgLogin: string;
  slug: string;
  name: string;
  description: string | null;
  privacy: GitHubTeamPrivacy;
  parentTeamId: string | null;
  parentTeamSlug: string | null;
  htmlUrl: string;
  membersCount: number | null;
  reposCount: number | null;
  syncState: "SYNCED" | "DELETED" | "ERROR";
  lastSyncedAt: string;
  installation?: {
    installationId: string;
    accountLogin: string;
    accountType: string;
  };
}

export interface GitHubTeamListResponse {
  items: GitHubTeam[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  complete: boolean;
  capabilities: GitHubTeamCapabilities;
  organization: {
    login: string;
    installationId: string;
    htmlUrl: string;
    lastOrgSyncedAt: string | null;
    orgSyncState: string | null;
  };
}

export type GitHubTeamMemberRole = "member" | "maintainer";
export type GitHubTeamMemberState = "active" | "pending";

export interface GitHubTeamMember {
  id: string;
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
  role: GitHubTeamMemberRole;
  state: GitHubTeamMemberState;
  source: "direct" | "inherited";
}

export interface GitHubPendingInvitation {
  id: string;
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
  role: GitHubTeamMemberRole;
  state: "pending";
  createdAt: string | null;
}

export interface GitHubTeamMemberListResponse {
  items: GitHubTeamMember[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  complete: boolean;
  pendingInvitations: GitHubPendingInvitation[];
  capabilities: GitHubTeamCapabilities;
}

export type GitHubRepoPermission =
  | "pull"
  | "triage"
  | "push"
  | "maintain"
  | "admin";

export interface GitHubTeamRepo {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  permission: string | null;
}

export interface GitHubAvailableRepo {
  id: string;
  repositoryId: string;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
}

export type ProjectTeamRole =
  | "OWNER"
  | "MAINTAINER"
  | "DEVELOPER"
  | "SECURITY_ANALYST"
  | "VIEWER";

export interface ProjectTeamLink {
  id: string;
  role: ProjectTeamRole;
  createdAt: string;
  updatedAt: string;
  team: GitHubTeam;
}

export interface TeamProjectLink {
  id: string;
  role: ProjectTeamRole;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    name: string;
    repoFullName: string;
    ownerId: string;
  };
}

export interface CreateGitHubTeamInput {
  name: string;
  description?: string;
  privacy: GitHubTeamPrivacy;
  parentTeamId?: string;
  maintainers?: string[];
  repoFullNames?: string[];
  notificationSetting?:
    | "notifications_enabled"
    | "notifications_disabled";
}

export const githubService = {
  // Démarre le flux d'installation (retourne l'URL GitHub)
  startInstall: () =>
    api.get<{ url: string }>("/api/github/install/start").then((r) => r.data.url),

  // Installations
  listInstallations: () =>
    api
      .get<{ installations: GitHubInstallation[] }>("/api/github/installations")
      .then((r) => r.data.installations),

  syncInstallation: (installationId: string) =>
    api.post(`/api/github/installations/${installationId}/sync`),

  revokeInstallation: (installationId: string) =>
    api.delete(`/api/github/installations/${installationId}`),

  // Repositories
  listRepositories: (params?: {
    installationId?: string;
    search?: string;
    private?: boolean;
    page?: number;
    pageSize?: number;
  }) =>
    api
      .get<{
        items: GitHubRepository[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      }>("/api/github/repositories", { params })
      .then((r) => r.data),

  getRepository: (id: string) =>
    api
      .get<{ repository: GitHubRepository }>(`/api/github/repositories/${id}`)
      .then((r) => r.data.repository),

  listBranches: (id: string) =>
    api
      .get<{ branches: GitHubBranch[] }>(`/api/github/repositories/${id}/branches`)
      .then((r) => r.data.branches),

  listCommits: (id: string, branch?: string) =>
    api
      .get<{ commits: GitHubCommit[] }>(`/api/github/repositories/${id}/commits`, {
        params: { branch },
      })
      .then((r) => r.data.commits),

  getBranchProtection: (id: string, branch?: string) =>
    api
      .get<{ branchProtection: BranchProtectionReport }>(
        `/api/github/repositories/${id}/branch-protection`,
        { params: { branch } },
      )
      .then((r) => r.data.branchProtection),

  // ----------------------------------------------------------
  // Organisations
  // ----------------------------------------------------------
  listOrganizations: () =>
    api
      .get<{ organizations: GitHubOrganization[] }>("/api/github/organizations")
      .then((r) => r.data.organizations),

  syncOrganization: (installationId: string) =>
    api
      .post<{
        organization: GitHubOrganization;
        teamsSynced: number;
        complete: boolean;
      }>(`/api/github/organizations/${installationId}/sync`)
      .then((r) => r.data),

  // ----------------------------------------------------------
  // Équipes
  // ----------------------------------------------------------
  listTeams: (
    installationId: string,
    params: {
      search?: string;
      privacy?: GitHubTeamPrivacy;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    api
      .get<GitHubTeamListResponse>(
        `/api/github/organizations/${installationId}/teams`,
        { params },
      )
      .then((r) => r.data),

  getTeam: (installationId: string, slug: string) =>
    api
      .get<{ team: GitHubTeam; capabilities: GitHubTeamCapabilities }>(
        `/api/github/organizations/${installationId}/teams/${slug}`,
      )
      .then((r) => r.data),

  syncTeam: (installationId: string, slug: string) =>
    api
      .post<{ team: GitHubTeam; capabilities: GitHubTeamCapabilities }>(
        `/api/github/organizations/${installationId}/teams/${slug}/sync`,
      )
      .then((r) => r.data),

  createTeam: (installationId: string, data: CreateGitHubTeamInput) =>
    api
      .post<{ team: GitHubTeam; capabilities: GitHubTeamCapabilities }>(
        `/api/github/organizations/${installationId}/teams`,
        data,
      )
      .then((r) => r.data),

  // ----------------------------------------------------------
  // Membres
  // ----------------------------------------------------------
  listMembers: (
    installationId: string,
    slug: string,
    params: { page?: number; pageSize?: number; role?: GitHubTeamMemberRole } = {},
  ) =>
    api
      .get<GitHubTeamMemberListResponse>(
        `/api/github/organizations/${installationId}/teams/${slug}/members`,
        { params },
      )
      .then((r) => r.data),

  addMember: (
    installationId: string,
    slug: string,
    data: { username: string; role: GitHubTeamMemberRole },
  ) =>
    api
      .put<{
        username: string;
        role: GitHubTeamMemberRole;
        state: GitHubTeamMemberState;
        message: string;
      }>(
        `/api/github/organizations/${installationId}/teams/${slug}/members/${data.username}`,
        { role: data.role },
      )
      .then((r) => r.data),

  removeMember: (installationId: string, slug: string, username: string) =>
    api
      .delete<{ username: string; removed: boolean }>(
        `/api/github/organizations/${installationId}/teams/${slug}/members/${username}`,
      )
      .then((r) => r.data),

  // ----------------------------------------------------------
  // Dépôts associés
  // ----------------------------------------------------------
  listTeamRepos: (
    installationId: string,
    slug: string,
    params: { page?: number; pageSize?: number } = {},
  ) =>
    api
      .get<{
        items: GitHubTeamRepo[];
        page: number;
        pageSize: number;
        hasNext: boolean;
        capabilities: GitHubTeamCapabilities;
        organization: string;
      }>(`/api/github/organizations/${installationId}/teams/${slug}/repos`, {
        params,
      })
      .then((r) => r.data),

  listAvailableRepos: (installationId: string, slug: string) =>
    api
      .get<{ items: GitHubAvailableRepo[]; organization: string }>(
        `/api/github/organizations/${installationId}/teams/${slug}/available-repos`,
      )
      .then((r) => r.data),

  setRepoPermission: (
    installationId: string,
    slug: string,
    owner: string,
    repo: string,
    permission: GitHubRepoPermission,
  ) =>
    api
      .put<{
        repository: string;
        permission: string;
        verified: boolean;
      }>(
        `/api/github/organizations/${installationId}/teams/${slug}/repos/${owner}/${repo}`,
        { permission },
      )
      .then((r) => r.data),

  removeTeamRepo: (
    installationId: string,
    slug: string,
    owner: string,
    repo: string,
  ) =>
    api
      .delete<{ repository: string; removed: boolean }>(
        `/api/github/organizations/${installationId}/teams/${slug}/repos/${owner}/${repo}`,
      )
      .then((r) => r.data),

  // ----------------------------------------------------------
  // Associations équipe → projet (vue équipe)
  // ----------------------------------------------------------
  listTeamProjects: (installationId: string, slug: string) =>
    api
      .get<{
        team: GitHubTeam;
        items: TeamProjectLink[];
      }>(`/api/github/organizations/${installationId}/teams/${slug}/projects`)
      .then((r) => r.data),

  associateTeamProject: (
    installationId: string,
    slug: string,
    projectId: string,
    role: ProjectTeamRole,
  ) =>
    api
      .post<{ link: TeamProjectLink }>(
        `/api/github/organizations/${installationId}/teams/${slug}/projects`,
        { projectId, role },
      )
      .then((r) => r.data.link),

  updateTeamProjectRole: (
    installationId: string,
    slug: string,
    linkId: string,
    role: ProjectTeamRole,
  ) =>
    api
      .patch<{ link: TeamProjectLink }>(
        `/api/github/organizations/${installationId}/teams/${slug}/projects/${linkId}`,
        { role },
      )
      .then((r) => r.data.link),

  removeTeamProject: (
    installationId: string,
    slug: string,
    linkId: string,
  ) =>
    api
      .delete(
        `/api/github/organizations/${installationId}/teams/${slug}/projects/${linkId}`,
      )
      .then((r) => r.data),
};