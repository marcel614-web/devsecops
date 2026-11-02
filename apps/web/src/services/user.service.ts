import { api } from "./api";
import type { Paginated } from "@/types/api";

export type ApiUser = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "DEVELOPER";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const userService = {
  list: (params?: { page?: number; pageSize?: number; search?: string; role?: string; isActive?: boolean }) =>
    api.get<Paginated<ApiUser>>("/api/users", { params }).then((r) => r.data),
  get: (id: string) =>
    api.get<{ user: ApiUser }>(`/api/users/${id}`).then((r) => r.data.user),
  create: (data: { email: string; name: string; password: string; role: "ADMIN" | "DEVELOPER" }) =>
    api.post<{ user: ApiUser }>("/api/users", data).then((r) => r.data.user),
  update: (id: string, data: Partial<{ name: string; email: string; role: "ADMIN" | "DEVELOPER"; isActive: boolean; password: string }>) =>
    api.patch<{ user: ApiUser }>(`/api/users/${id}`, data).then((r) => r.data.user),
  setActive: (id: string, isActive: boolean) =>
    api.patch<{ user: ApiUser }>(`/api/users/${id}`, { isActive }).then((r) => r.data.user),
  deactivate: (id: string) =>
    api.patch<{ user: ApiUser }>(`/api/users/${id}`, { isActive: false }).then((r) => r.data.user),
  delete: (id: string) => api.delete(`/api/users/${id}`),
};