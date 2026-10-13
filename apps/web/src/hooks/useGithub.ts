// apps/web/src/hooks/useGithub.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubService } from "@/services/github.service";

export function useGithubStatus() {
  return useQuery({
    queryKey: ["github", "status"],
    queryFn: githubService.status,
    refetchInterval: 30_000,
  });
}

export function useGithubRepos(enabled: boolean) {
  return useQuery({
    queryKey: ["github", "repos"],
    queryFn: () => githubService.listRepos({ perPage: 100, sort: "updated" }),
    enabled,
    staleTime: 60_000,
  });
}

export function useGithubBranches(owner: string | null, repo: string | null) {
  return useQuery({
    queryKey: ["github", "branches", owner, repo],
    queryFn: () => githubService.listBranches(owner!, repo!),
    enabled: !!owner && !!repo,
  });
}

export function useDisconnectGithub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: githubService.disconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github"] });
    },
  });
}