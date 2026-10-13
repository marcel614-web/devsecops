// apps/web/src/hooks/usePipeline.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pipelineService } from "@/services/pipeline.service";

/**
 * Détail d'un pipeline avec polling intelligent :
 *  - 3 s tant que le pipeline est QUEUED/RUNNING
 *  - arrêt automatique sinon
 */
export function usePipelineDetail(projectId: string | undefined, pipelineId: string | undefined) {
  return useQuery({
    queryKey: ["pipeline", projectId, pipelineId],
    queryFn: () => pipelineService.get(projectId!, pipelineId!),
    enabled: !!projectId && !!pipelineId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 3_000 : false;
    },
  });
}

/**
 * Scans d'un pipeline. Récupérés une fois le pipeline démarré.
 */
export function usePipelineScans(
  projectId: string | undefined,
  pipelineId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["pipeline-scans", projectId, pipelineId],
    queryFn: () => pipelineService.scans(projectId!, pipelineId!),
    enabled: !!projectId && !!pipelineId && enabled,
  });
}

/**
 * Logs d'un pipeline. Polling toutes les 3 s pendant l'exécution.
 */
export function usePipelineLogs(
  projectId: string | undefined,
  pipelineId: string | undefined,
  filters: { stepId?: string; level?: string } = {},
  isRunning = false,
) {
  return useQuery({
    queryKey: ["pipeline-logs", projectId, pipelineId, filters],
    queryFn: () =>
      pipelineService.logs(projectId!, pipelineId!, {
        pageSize: 1000,
        ...filters,
      }),
    enabled: !!projectId && !!pipelineId,
    refetchInterval: isRunning ? 3_000 : false,
  });
}

export function useCancelPipeline(projectId: string, pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => pipelineService.cancel(projectId, pipelineId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline", projectId, pipelineId] });
    },
  });
}