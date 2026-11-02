// apps/web/src/services/rescan.service.ts
import { api } from "./api";
import type {
  Paginated,
  Pipeline,
  RescanDetail,
  RescanRun,
} from "@/types/api";

export const rescanService = {
  list: (projectId: string, params?: { page?: number; pageSize?: number }) =>
    api
      .get<Paginated<RescanRun>>(`/api/projects/${projectId}/rescans`, {
        params,
      })
      .then((r) => r.data),

  get: (projectId: string, runId: string) =>
    api
      .get<{ rescan: RescanDetail }>(
        `/api/projects/${projectId}/rescans/${runId}`,
      )
      .then((r) => r.data.rescan),

  trigger: (projectId: string) =>
    api
      .post<{ rescan: RescanRun }>(`/api/projects/${projectId}/rescans`)
      .then((r) => r.data.rescan),

  cancel: (projectId: string, runId: string) =>
    api
      .post<{ rescan: RescanRun }>(
        `/api/projects/${projectId}/rescans/${runId}/cancel`,
      )
      .then((r) => r.data.rescan),

  remediate: (projectId: string, runId: string, reason?: string) =>
    api
      .post<{ pipeline: Pipeline }>(
        `/api/projects/${projectId}/rescans/${runId}/remediation`,
        { reason },
      )
      .then((r) => r.data.pipeline),
};
