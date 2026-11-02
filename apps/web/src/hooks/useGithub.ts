// apps/web/src/hooks/useGithub.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubService } from "@/services/github.service";

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
  } = {},
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["github", "repositories", params],
    queryFn: () => githubService.listRepositories({ ...params, pageSize: 30 }),
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