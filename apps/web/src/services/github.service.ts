// apps/web/src/services/github.service.ts
import { api } from "./api";

export interface GithubConnectionStatus {
  connected: boolean;
  login: string | null;
  githubUserId: string | null;
  scopes: string | null;
  connectedAt: string | null;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  clone_url: string;
  default_branch: string;
  owner: { login: string; avatar_url: string };
  updated_at: string;
  pushed_at: string | null;
  language: string | null;
}

export interface GithubBranch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  html_url: string;
}

export const githubService = {
  status: () =>
    api
      .get<GithubConnectionStatus>("/api/github/status")
      .then((r) => r.data),

  disconnect: () => api.delete("/api/github/disconnect"),

  /**
   * Retourne l'URL d'autorisation GitHub. Le navigateur y sera redirigé.
   * Cette URL passe par notre API qui ajoute le state signé.
   */
  getConnectUrl: () => {
    const baseUrl = api.defaults.baseURL ?? "http://localhost:4000";
    return `${baseUrl}/api/github/connect`;
  },

  listRepos: (params?: { page?: number; perPage?: number; type?: string; sort?: string }) =>
    api
      .get<{ repositories: GithubRepo[]; total: number }>("/api/github/repos", { params })
      .then((r) => r.data),

  getRepo: (owner: string, repo: string) =>
    api
      .get<{ repository: GithubRepo }>(`/api/github/repos/${owner}/${repo}`)
      .then((r) => r.data.repository),

  listBranches: (owner: string, repo: string) =>
    api
      .get<{ branches: GithubBranch[] }>(
        `/api/github/repos/${owner}/${repo}/branches`,
      )
      .then((r) => r.data.branches),

  listCommits: (owner: string, repo: string, branch?: string) =>
    api
      .get<{ commits: GithubCommit[] }>(
        `/api/github/repos/${owner}/${repo}/commits`,
        { params: { branch } },
      )
      .then((r) => r.data.commits),
};