// apps/web/src/hooks/useProjects.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectService, type ListProjectsParams } from "@/services/project.service";
import type { ProjectTeamRole } from "@/services/github.service";

export function useProjects(params: ListProjectsParams) {
  return useQuery({
    queryKey: ["projects", params],
    queryFn: () => projectService.list(params),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => projectService.get(id!),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: projectService.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    },
  });
}

// ============================================================
// ÉQUIPES GITHUB ASSOCIÉES AU PROJET
// ============================================================

export function useProjectTeams(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-teams", projectId],
    queryFn: () => projectService.listTeams(projectId!),
    enabled: !!projectId,
  });
}

export function useAvailableProjectTeams(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-teams", "available", projectId],
    queryFn: () => projectService.listAvailableTeams(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useAssociateProjectTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { githubTeamId: string; role: ProjectTeamRole }) =>
      projectService.associateTeam(
        projectId,
        input.githubTeamId,
        input.role,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-teams", projectId] });
      qc.invalidateQueries({ queryKey: ["project-teams", "available", projectId] });
    },
  });
}

export function useUpdateProjectTeamRole(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { linkId: string; role: ProjectTeamRole }) =>
      projectService.updateTeamRole(projectId, input.linkId, input.role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-teams", projectId] });
    },
  });
}

export function useRemoveProjectTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      projectService.removeTeam(projectId, linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-teams", projectId] });
      qc.invalidateQueries({ queryKey: ["project-teams", "available", projectId] });
    },
  });
}