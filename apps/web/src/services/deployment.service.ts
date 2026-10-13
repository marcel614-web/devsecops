// apps/web/src/services/deployment.service.ts
import { api } from "./api";
import type { Deployment, Paginated } from "@/types/api";

export const deploymentService = {
  listByProject: (projectId: string, params?: { page?: number; pageSize?: number }) =>
    api
      .get<Paginated<Deployment>>(`/api/projects/${projectId}/deployments`, { params })
      .then((r) => r.data),
};