// apps/web/src/services/server.service.ts
import { api } from "./api";
import type { DeploymentServer, Paginated } from "@/types/api";

export interface CreateServerInput {
  name: string;
  host: string;
  sshPort?: number;
  username: string;
  authType: "SSH_KEY" | "PASSWORD";
  privateKey?: string;
  passphrase?: string;
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  sshPort?: number;
  username?: string;
  privateKey?: string;
  passphrase?: string;
}

export const serverService = {
  list: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api
      .get<Paginated<DeploymentServer>>("/api/servers", { params })
      .then((r) => r.data),

  get: (id: string) =>
    api
      .get<{ server: DeploymentServer }>(`/api/servers/${id}`)
      .then((r) => r.data.server),

  create: (data: CreateServerInput) =>
    api
      .post<{ server: DeploymentServer }>("/api/servers", data)
      .then((r) => r.data.server),

  update: (id: string, data: UpdateServerInput) =>
    api
      .patch<{ server: DeploymentServer }>(`/api/servers/${id}`, data)
      .then((r) => r.data.server),

  remove: (id: string) => api.delete(`/api/servers/${id}`),
};