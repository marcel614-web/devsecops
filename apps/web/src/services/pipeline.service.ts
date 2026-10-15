// apps/web/src/services/pipeline.service.ts
import { api } from "./api";
import type {
  Paginated,
  Pipeline,
  PipelineDetail,
  PipelineLog,
  SecurityScan,
  SecurityReport,
} from "@/types/api";

export interface ListPipelinesParams {
  page?: number;
  pageSize?: number;
  status?: string;
  branch?: string;
}

export interface RunPipelineInput {
  branch?: string;
  commitSha?: string;
  author?: string;
  trigger?: string;
}

export const pipelineService = {
  listByProject: (projectId: string, params?: ListPipelinesParams) =>
    api
      .get<Paginated<Pipeline>>(`/api/projects/${projectId}/pipelines`, { params })
      .then((r) => r.data),

  get: (projectId: string, pipelineId: string) =>
    api
      .get<{ pipeline: PipelineDetail }>(
        `/api/projects/${projectId}/pipelines/${pipelineId}`,
      )
      .then((r) => r.data.pipeline),

  run: (projectId: string, data?: RunPipelineInput) =>
    api
      .post<{ pipeline: Pipeline }>(
        `/api/projects/${projectId}/pipelines/run`,
        data ?? {},
      )
      .then((r) => r.data.pipeline),

  cancel: (projectId: string, pipelineId: string) =>
    api.post(`/api/projects/${projectId}/pipelines/${pipelineId}/cancel`),

  delete: (projectId: string, pipelineId: string) =>
    api.delete(`/api/projects/${projectId}/pipelines/${pipelineId}`),

  logs: (
    projectId: string,
    pipelineId: string,
    params?: { pageSize?: number; level?: string; stepId?: string },
  ) =>
    api
      .get<Paginated<PipelineLog>>(
        `/api/projects/${projectId}/pipelines/${pipelineId}/logs`,
        { params },
      )
      .then((r) => r.data),

  scans: (projectId: string, pipelineId: string) =>
    api
      .get<{ scans: SecurityScan[] }>(
        `/api/projects/${projectId}/pipelines/${pipelineId}/scans`,
      )
      .then((r) => r.data.scans),

  report: (projectId: string, pipelineId: string) =>
    api
      .get<{ report: SecurityReport }>(
        `/api/projects/${projectId}/pipelines/${pipelineId}/report`,
      )
      .then((r) => r.data.report),
};