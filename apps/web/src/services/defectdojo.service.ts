// apps/web/src/services/defectdojo.service.ts
import { api } from "./api";

export interface DefectDojoConfigPublic {
  configured: boolean;
  url: string | null;
  hasApiToken: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpdateDefectDojoConfigInput {
  url?: string;
  apiToken?: string;
}

export interface DefectDojoImport {
  id: string;
  projectId: string;
  pipelineId: string | null;
  engagementId: number;
  status: string;
  externalId: string | null;
  error: string | null;
  createdAt: string;
}

export const defectDojoService = {
  getConfig: () =>
    api
      .get<{ config: DefectDojoConfigPublic }>("/api/defectdojo/config")
      .then((r) => r.data.config),

  updateConfig: (input: UpdateDefectDojoConfigInput) =>
    api
      .put<{ config: DefectDojoConfigPublic }>("/api/defectdojo/config", input)
      .then((r) => r.data.config),

  testConfig: (input: UpdateDefectDojoConfigInput) =>
    api
      .post<{ ok: boolean; message: string }>("/api/defectdojo/config/test", input)
      .then((r) => r.data),

  exportPipeline: (projectId: string, input: { pipelineId: string; engagementId: number }) =>
    api
      .post<{ status: string; externalId?: string; error?: string }>(
        `/api/defectdojo/projects/${projectId}/export`,
        input,
      )
      .then((r) => r.data),

  listImports: (projectId: string) =>
    api
      .get<{ imports: DefectDojoImport[] }>(`/api/defectdojo/projects/${projectId}/imports`)
      .then((r) => r.data.imports),
};