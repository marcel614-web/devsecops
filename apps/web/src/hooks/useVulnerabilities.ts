// apps/web/src/hooks/useVulnerabilities.ts
import { useQuery } from "@tanstack/react-query";
import { vulnerabilityService } from "@/services/vulnerability.service";
import type { Severity } from "@/types/api";

export function useProjectVulnerabilities(
  projectId: string | undefined,
  filters: {
    page?: number;
    pageSize?: number;
    severity?: Severity;
    tool?: string;
    search?: string;
  } = {},
) {
  return useQuery({
    queryKey: ["vulnerabilities", projectId, filters],
    queryFn: () => vulnerabilityService.listByProject(projectId!, filters),
    enabled: !!projectId,
  });
}