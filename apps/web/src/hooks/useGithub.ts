// apps/web/src/hooks/useGithub.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  githubService,
  type CreateGitHubTeamInput,
  type GitHubRepoPermission,
  type GitHubTeamMemberRole,
  type GitHubTeamPrivacy,
  type ProjectTeamRole,
} from "@/services/github.service";

export function useGithubInstallations() {
  return useQuery({
    queryKey: ["github", "installations"],
    queryFn: githubService.listInstallations,
    refetchInterval: 30_000,
  });
}

export function useGithubRepositories(
  params: {
    installationId?: string;
    search?: string;
    private?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["github", "repositories", params],
    queryFn: () =>
      githubService.listRepositories({
        ...params,
        pageSize: params.pageSize ?? 30,
      }),
    enabled,
    staleTime: 30_000,
  });
}

export function useGithubBranches(repositoryId: string | null) {
  return useQuery({
    queryKey: ["github", "branches", repositoryId],
    queryFn: () => githubService.listBranches(repositoryId!),
    enabled: !!repositoryId,
  });
}

export function useBranchProtection(
  repositoryId: string | null,
  branch: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["github", "branch-protection", repositoryId, branch],
    queryFn: () => githubService.getBranchProtection(repositoryId!, branch ?? undefined),
    enabled: !!repositoryId && enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRevokeInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) =>
      githubService.revokeInstallation(installationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github"] });
    },
  });
}

export function useSyncInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) =>
      githubService.syncInstallation(installationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github"] });
    },
  });
}

// ============================================================
// ORGANISATIONS & ÉQUIPES
// ============================================================

export function useGithubOrganizations() {
  return useQuery({
    queryKey: ["github", "organizations"],
    queryFn: githubService.listOrganizations,
    staleTime: 30_000,
  });
}

export function useSyncOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) =>
      githubService.syncOrganization(installationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github"] });
    },
  });
}

export function useGithubTeams(
  installationId: string | null,
  params: {
    search?: string;
    privacy?: GitHubTeamPrivacy;
    page?: number;
    pageSize?: number;
  } = {},
) {
  return useQuery({
    queryKey: ["github", "teams", installationId, params],
    queryFn: () => githubService.listTeams(installationId!, params),
    enabled: !!installationId,
    staleTime: 15_000,
  });
}

export function useGithubTeam(
  installationId: string | null,
  slug: string | null,
) {
  return useQuery({
    queryKey: ["github", "team", installationId, slug],
    queryFn: () => githubService.getTeam(installationId!, slug!),
    enabled: !!installationId && !!slug,
    staleTime: 15_000,
  });
}

export function useSyncTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      installationId,
      slug,
    }: {
      installationId: string;
      slug: string;
    }) => githubService.syncTeam(installationId, slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github"] });
    },
  });
}

export function useCreateTeam(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGitHubTeamInput) =>
      githubService.createTeam(installationId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "teams", installationId] });
      qc.invalidateQueries({ queryKey: ["github", "organizations"] });
    },
  });
}

// ============================================================
// MEMBRES
// ============================================================

export function useGithubTeamMembers(
  installationId: string | null,
  slug: string | null,
  params: {
    page?: number;
    pageSize?: number;
    role?: GitHubTeamMemberRole;
  } = {},
) {
  return useQuery({
    queryKey: ["github", "team-members", installationId, slug, params],
    queryFn: () => githubService.listMembers(installationId!, slug!, params),
    enabled: !!installationId && !!slug,
    staleTime: 15_000,
  });
}

export function useAddTeamMember(installationId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; role: GitHubTeamMemberRole }) =>
      githubService.addMember(installationId, slug, data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-members", installationId, slug],
      });
      qc.invalidateQueries({ queryKey: ["github", "team", installationId, slug] });
    },
  });
}

export function useRemoveTeamMember(installationId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      githubService.removeMember(installationId, slug, username),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-members", installationId, slug],
      });
      qc.invalidateQueries({ queryKey: ["github", "team", installationId, slug] });
    },
  });
}

// ============================================================
// DÉPÔTS ASSOCIÉS
// ============================================================

export function useGithubTeamRepos(
  installationId: string | null,
  slug: string | null,
  page: number,
) {
  return useQuery({
    queryKey: ["github", "team-repos", installationId, slug, page],
    queryFn: () =>
      githubService.listTeamRepos(installationId!, slug!, {
        page,
        pageSize: 30,
      }),
    enabled: !!installationId && !!slug,
    staleTime: 15_000,
  });
}

export function useAvailableTeamRepos(
  installationId: string | null,
  slug: string | null,
) {
  return useQuery({
    queryKey: ["github", "team-available-repos", installationId, slug],
    queryFn: () => githubService.listAvailableRepos(installationId!, slug!),
    enabled: !!installationId && !!slug,
    staleTime: 30_000,
  });
}

export function useSetTeamRepoPermission(
  installationId: string,
  slug: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      owner: string;
      repo: string;
      permission: GitHubRepoPermission;
    }) =>
      githubService.setRepoPermission(
        installationId,
        slug,
        input.owner,
        input.repo,
        input.permission,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-repos", installationId, slug],
      });
    },
  });
}

export function useRemoveTeamRepo(installationId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { owner: string; repo: string }) =>
      githubService.removeTeamRepo(
        installationId,
        slug,
        input.owner,
        input.repo,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-repos", installationId, slug],
      });
    },
  });
}

// ============================================================
// ASSOCIATIONS ÉQUIPE → PROJET (vue équipe)
// ============================================================

export function useTeamProjects(
  installationId: string | null,
  slug: string | null,
) {
  return useQuery({
    queryKey: ["github", "team-projects", installationId, slug],
    queryFn: () => githubService.listTeamProjects(installationId!, slug!),
    enabled: !!installationId && !!slug,
    staleTime: 15_000,
  });
}

export function useAssociateTeamProject(
  installationId: string,
  slug: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; role: ProjectTeamRole }) =>
      githubService.associateTeamProject(
        installationId,
        slug,
        input.projectId,
        input.role,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-projects", installationId, slug],
      });
      qc.invalidateQueries({ queryKey: ["project-teams"] });
    },
  });
}

export function useUpdateTeamProjectRole(
  installationId: string,
  slug: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { linkId: string; role: ProjectTeamRole }) =>
      githubService.updateTeamProjectRole(
        installationId,
        slug,
        input.linkId,
        input.role,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-projects", installationId, slug],
      });
      qc.invalidateQueries({ queryKey: ["project-teams"] });
    },
  });
}

export function useRemoveTeamProject(
  installationId: string,
  slug: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      githubService.removeTeamProject(installationId, slug, linkId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["github", "team-projects", installationId, slug],
      });
      qc.invalidateQueries({ queryKey: ["project-teams"] });
    },
  });
}