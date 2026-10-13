// apps/web/src/services/project.service.ts
import { api } from "./api";
import type {
  Paginated,
  Project,
  ProjectConfiguration,
  ProjectDetail,
} from "@/types/api";

export interface ListProjectsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  technology?: string;
  provider?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  provider?: "GITHUB" | "GITLAB";
  repoFullName: string;
  repoId: string;
  defaultBranch?: string;
  technology?: "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN";
  deploymentEnabled?: boolean;
  serverId?: string | null;
}

export const projectService = {
  list: (params?: ListProjectsParams) =>
    api.get<Paginated<Project>>("/api/projects", { params }).then((r) => r.data),

  get: (id: string) =>
    api
      .get<{ project: ProjectDetail }>(`/api/projects/${id}`)
      .then((r) => r.data.project),

  create: (data: CreateProjectInput) =>
    api.post<{ project: Project }>("/api/projects", data).then((r) => r.data.project),

  update: (id: string, data: Partial<Project>) =>
    api.patch<{ project: Project }>(`/api/projects/${id}`, data).then((r) => r.data.project),

  remove: (id: string) => api.delete(`/api/projects/${id}`),

  getConfig: (id: string) =>
    api
      .get<{ config: ProjectConfiguration }>(`/api/projects/${id}/config`)
      .then((r) => r.data.config),

  updateConfig: (id: string, data: Partial<ProjectConfiguration>) =>
    api
      .patch<{ config: ProjectConfiguration }>(`/api/projects/${id}/config`, data)
      .then((r) => r.data.config),
};