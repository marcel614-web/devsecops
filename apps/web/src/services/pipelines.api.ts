import { api } from "./api";
import type { Paginated, Pipeline, PipelineDetail, PipelineLog, SecurityScan } from "@/types/api";

export const pipelinesApi = {
  list: (projectId: string, params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get<Paginated<Pipeline>>(`/api/projects/${projectId}/pipelines`, { params }).then((r) => r.data),

  get: (projectId: string, id: string) =>
    api.get<{ pipeline: PipelineDetail }>(`/api/projects/${projectId}/pipelines/${id}`).then((r) => r.data.pipeline),

  run: (projectId: string, data?: { branch?: string; commitSha?: string }) =>
    api.post<{ pipeline: Pipeline }>(`/api/projects/${projectId}/pipelines/run`, data ?? {}).then((r) => r.data.pipeline),

  rerun: (projectId: string, id: string) =>
    api.post<{ pipeline: Pipeline }>(`/api/projects/${projectId}/pipelines/${id}/rerun`).then((r) => r.data.pipeline),

  resume: (projectId: string, id: string) =>
    api.post<{ pipeline: Pipeline }>(`/api/projects/${projectId}/pipelines/${id}/resume`).then((r) => r.data.pipeline),

  cancel: (projectId: string, id: string) =>
    api.post(`/api/projects/${projectId}/pipelines/${id}/cancel`),

  logs: (projectId: string, id: string, params?: { pageSize?: number; level?: string; stepId?: string }) =>
    api.get<Paginated<PipelineLog>>(`/api/projects/${projectId}/pipelines/${id}/logs`, { params }).then((r) => r.data),

  scans: (projectId: string, id: string) =>
    api.get<{ scans: SecurityScan[] }>(`/api/projects/${projectId}/pipelines/${id}/scans`).then((r) => r.data.scans),

  report: (projectId: string, id: string) =>
    api.get<{ report: { summaryJson: Record<string, unknown>; createdAt: string } }>(`/api/projects/${projectId}/pipelines/${id}/report`).then((r) => r.data.report),
};