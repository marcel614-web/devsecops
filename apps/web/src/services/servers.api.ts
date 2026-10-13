import { api } from "./api";
import type { DeploymentServer, Paginated } from "@/types/api";

export const serversApi = {
  list: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<Paginated<DeploymentServer>>("/api/servers", { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<{ server: DeploymentServer }>(`/api/servers/${id}`).then((r) => r.data.server),

  create: (data: {
    name: string; host: string; sshPort?: number; username: string;
    authType: string; privateKey?: string;
  }) => api.post<{ server: DeploymentServer }>("/api/servers", data).then((r) => r.data.server),

  remove: (id: string) => api.delete(`/api/servers/${id}`),
};