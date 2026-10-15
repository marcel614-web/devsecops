// apps/web/src/services/deployment.service.ts
import { api } from "./api";
import type { Deployment, Paginated } from "@/types/api";

export const deploymentService = {
  list: () =>
    api.get<{ items: Deployment[] }>("/api/deployments").then((r) => r.data.items),

  get: (id: string) =>
    api.get<{ deployment: Deployment }>(`/api/deployments/${id}`).then((r) => r.data.deployment),

  start: (id: string) =>
    api.post(`/api/deployments/${id}/start`).then((r) => r.data),

  stop: (id: string) =>
    api.post(`/api/deployments/${id}/stop`).then((r) => r.data),

  restart: (id: string) =>
    api.post(`/api/deployments/${id}/restart`).then((r) => r.data),

  uninstall: (id: string) =>
    api.delete(`/api/deployments/${id}`).then((r) => r.data),

  listByProject: (projectId: string, params?: { page?: number; pageSize?: number }) =>
    api
      .get<Paginated<Deployment>>(`/api/projects/${projectId}/deployments`, { params })
      .then((r) => r.data),
};