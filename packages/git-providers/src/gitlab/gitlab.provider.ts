// packages/git-providers/src/gitlab/gitlab.provider.ts
import type {
  GitBranch,
  GitCommit,
  GitProvider,
  GitProviderAuth,
  GitRepository,
  ListProjectsOptions,
} from "../provider";

export class GitLabProvider implements GitProvider {
  readonly name = "gitlab" as const;

  constructor(private readonly baseUrl = "https://gitlab.com") {}

  private headers(auth: GitProviderAuth): HeadersInit {
    return {
      "PRIVATE-TOKEN": auth.token,
      Accept: "application/json",
    };
  }

  private projectPath(project: string): string {
    return encodeURIComponent(project);
  }

  async listProjects(
    auth: GitProviderAuth,
    options: ListProjectsOptions = {},
  ): Promise<GitRepository[]> {
    const perPage = Math.min(Math.max(options.perPage ?? 20, 1), 100);
    const url = new URL("/api/v4/projects", this.baseUrl);
    url.searchParams.set("membership", "true");
    url.searchParams.set("per_page", String(perPage));
    if (options.search) url.searchParams.set("search", options.search);

    const response = await fetch(url, { headers: this.headers(auth) });
    if (!response.ok) {
      throw new Error(`GitLab listProjects failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as Array<{
      id: number;
      path_with_namespace: string;
      default_branch: string | null;
      web_url: string;
    }>;
    return data.map((project) => ({
      id: String(project.id),
      fullName: project.path_with_namespace,
      defaultBranch: project.default_branch ?? "main",
      webUrl: project.web_url,
    }));
  }

  async listBranches(
    auth: GitProviderAuth,
    project: string,
  ): Promise<GitBranch[]> {
    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectPath(project)}/repository/branches?per_page=100`,
      { headers: this.headers(auth) },
    );
    if (!response.ok) {
      throw new Error(`GitLab listBranches failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as Array<{
      name: string;
      commit: { id: string };
    }>;
    return data.map((branch) => ({
      name: branch.name,
      commitSha: branch.commit.id,
    }));
  }

  async getCommit(
    auth: GitProviderAuth,
    project: string,
    sha: string,
  ): Promise<GitCommit> {
    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectPath(project)}/repository/commits/${encodeURIComponent(sha)}`,
      { headers: this.headers(auth) },
    );
    if (!response.ok) {
      throw new Error(`GitLab getCommit failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      id: string;
      message: string;
      author_name?: string;
      committed_date?: string;
    };
    return {
      sha: data.id,
      message: data.message,
      author: data.author_name,
      committedAt: data.committed_date,
    };
  }

  verifyWebhook(
    headers: Record<string, string | undefined>,
    _rawBody: string,
    secret: string,
  ): boolean {
    const token = headers["x-gitlab-token"];
    return typeof token === "string" && token === secret;
  }
}