// apps/web/src/services/server.service.ts
import { api } from "./api";
import type { DeploymentServer, Paginated } from "@/types/api";

// ============================================================
// TYPES
// ============================================================

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

export interface ServerToolStatus {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface ServerSshStatus {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export interface ServerTestResult {
  ssh: ServerSshStatus;
  docker: ServerToolStatus;
  dockerCompose: ServerToolStatus;
  nginx: ServerToolStatus;
}

export interface ServerTestResponse {
  result: ServerTestResult;
  status: "ok" | "failed";
  lastCheckedAt: string;
}

// ============================================================
// SERVICE
// ============================================================

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

  /**
   * Teste la connexion SSH + vérifie Docker / Docker Compose / Nginx.
   * Met à jour le status du serveur en base (ok / failed).
   */
  testServer: (id: string) =>
    api
      .post<ServerTestResponse>(`/api/servers/${id}/test`)
      .then((r) => r.data),

  cleanupImages: (id: string) =>
    api
      .post<{ output: string }>(`/api/servers/${id}/cleanup-images`)
      .then((r) => r.data),
};