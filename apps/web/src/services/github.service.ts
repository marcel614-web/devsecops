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
};