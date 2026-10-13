import { api } from "./api";
import type { Paginated, Severity, Vulnerability } from "@/types/api";

export const vulnerabilitiesApi = {
  list: (projectId: string, params?: {
    page?: number; pageSize?: number; severity?: Severity; tool?: string; search?: string;
  }) =>
    api.get<Paginated<Vulnerability> & { severityCounts: Record<Severity, number> }>(
      `/api/projects/${projectId}/vulnerabilities`, { params },
    ).then((r) => r.data),
};