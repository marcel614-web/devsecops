// packages/git-providers/src/provider.ts
export interface GitRepository {
  id: string;
  fullName: string;
  defaultBranch: string;
  webUrl?: string;
}

export interface GitBranch {
  name: string;
  commitSha: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author?: string;
  committedAt?: string;
}

export interface ListProjectsOptions {
  search?: string;
  perPage?: number;
}

export interface GitProviderAuth {
  token: string;
}

export interface GitProvider {
  readonly name: "github" | "gitlab";

  listProjects(
    auth: GitProviderAuth,
    options?: ListProjectsOptions,
  ): Promise<GitRepository[]>;

  listBranches(
    auth: GitProviderAuth,
    project: string,
  ): Promise<GitBranch[]>;

  getCommit(
    auth: GitProviderAuth,
    project: string,
    sha: string,
  ): Promise<GitCommit>;

  verifyWebhook?(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret: string,
  ): boolean;
}
