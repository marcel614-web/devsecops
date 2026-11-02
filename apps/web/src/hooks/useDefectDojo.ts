// apps/web/src/hooks/useDefectDojo.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defectDojoService } from "@/services/defectdojo.service";

export function useDefectDojoConfig() {
  return useQuery({
    queryKey: ["defectdojo", "config"],
    queryFn: defectDojoService.getConfig,
  });
}

export function useUpdateDefectDojoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: defectDojoService.updateConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["defectdojo"] }),
  });
}

export function useTestDefectDojoConfig() {
  return useMutation({
    mutationFn: defectDojoService.testConfig,
  });
}

export function useDefectDojoImports(projectId: string) {
  return useQuery({
    queryKey: ["defectdojo", "imports", projectId],
    queryFn: () => defectDojoService.listImports(projectId),
  });
}

export function useExportDefectDojo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { projectId: string; pipelineId: string; engagementId: number }) =>
      defectDojoService.exportPipeline(params.projectId, {
        pipelineId: params.pipelineId,
        engagementId: params.engagementId,
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["defectdojo", "imports", variables.projectId] });
    },
  });
}