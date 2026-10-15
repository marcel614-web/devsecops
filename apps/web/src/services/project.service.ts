// apps/web/src/services/project.service.ts
import { api } from "./api";
import type {
  Paginated,
  Project,
  ProjectConfiguration,
  ProjectDetail,
  Technology,
} from "@/types/api";

// ============================================================
// TYPES
// ============================================================

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
  technology?: Technology;
  deploymentEnabled?: boolean;
  serverId?: string | null;
}

/**
 * Champs modifiables d'un projet.
 * On liste explicitement pour éviter les patches accidentels.
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  defaultBranch?: string;
  technology?: Technology;
  deploymentEnabled?: boolean;
  serverId?: string | null;
  githubRepositoryId?: string | null;
  monitoredBranch?: string | null;
}

/**
 * Champs modifiables de la configuration.
 */
export interface UpdateProjectConfigInput {
  triggerBranches?: string[];
  gitleaksEnabled?: boolean;
  semgrepEnabled?: boolean;
  scaEnabled?: boolean;
  trivyEnabled?: boolean;
  zapEnabled?: boolean;
  securityGateCritical?: number;
  securityGateHigh?: number;
  securityGateMedium?: number;
  securityGateLow?: number;
}

// ============================================================
// SERVICE
// ============================================================

export const projectService = {
  // ----------------------------------------------------------
  // CRUD
  // ----------------------------------------------------------
  list: (params?: ListProjectsParams) =>
    api
      .get<Paginated<Project>>("/api/projects", { params })
      .then((r) => r.data),

  get: (id: string) =>
    api
      .get<{ project: ProjectDetail }>(`/api/projects/${id}`)
      .then((r) => r.data.project),

  create: (data: CreateProjectInput) =>
    api
      .post<{ project: Project }>("/api/projects", data)
      .then((r) => r.data.project),

  update: (id: string, data: UpdateProjectInput) =>
    api
      .patch<{ project: Project }>(`/api/projects/${id}`, data)
      .then((r) => r.data.project),

  remove: (id: string) => api.delete(`/api/projects/${id}`),

  // ----------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------
  getConfig: (id: string) =>
    api
      .get<{ config: ProjectConfiguration }>(`/api/projects/${id}/config`)
      .then((r) => r.data.config),

  updateConfig: (id: string, data: UpdateProjectConfigInput) =>
    api
      .patch<{ config: ProjectConfiguration }>(
        `/api/projects/${id}/config`,
        data,
      )
      .then((r) => r.data.config),

  // ----------------------------------------------------------
  // Association repository GitHub
  // ----------------------------------------------------------
  associateRepository: (
    projectId: string,
    repositoryId: string,
    branch: string,
  ) =>
    api
      .post<{ project: unknown }>(`/api/projects/${projectId}/repository`, {
        repositoryId,
        branch,
      })
      .then((r) => r.data.project),

  detachRepository: (projectId: string) =>
    api.delete(`/api/projects/${projectId}/repository`),
};