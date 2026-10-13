// apps/web/src/hooks/useProjects.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectService, type ListProjectsParams } from "@/services/project.service";

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