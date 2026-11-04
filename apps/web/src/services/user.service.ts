import { api } from "./api";
import type {
  Paginated,
  ProjectRole,
  Role,
  SpecialPermission,
  UserStatus,
} from "@/types/api";

export type ApiUser = {
  id: string;
  email: string;
  username?: string | null;
  name: string | null;
  role: Role;
  status: UserStatus;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { projectMemberships: number };
};

export type EffectivePermissions = {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    status: UserStatus;
  };
  projectRole: ProjectRole | null;
  permissions: string[];
  specialPermissions: SpecialPermission[];
};

export const userService = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: string;
    status?: UserStatus;
    isActive?: boolean;
  }) => api.get<Paginated<ApiUser>>("/api/users", { params }).then((r) => r.data),
  get: (id: string) =>
    api.get<{ user: ApiUser }>(`/api/users/${id}`).then((r) => r.data.user),
  create: (data: {
    email: string;
    name: string;
    username?: string;
    password: string;
    role: Role;
    status?: UserStatus;
  }) => api.post<{ user: ApiUser }>("/api/users", data).then((r) => r.data.user),
  update: (
    id: string,
    data: Partial<{
      name: string;
      email: string;
      username: string | null;
      role: Role;
      status: UserStatus;
      isActive: boolean;
      password: string;
    }>,
  ) => api.patch<{ user: ApiUser }>(`/api/users/${id}`, data).then((r) => r.data.user),
  suspend: (id: string) =>
    api.post<{ user: ApiUser }>(`/api/users/${id}/suspend`).then((r) => r.data.user),
  reactivate: (id: string) =>
    api
      .post<{ user: ApiUser }>(`/api/users/${id}/reactivate`)
      .then((r) => r.data.user),
  revokeSessions: (id: string) =>
    api.post(`/api/users/${id}/revoke-sessions`).then((r) => r.data),
  activity: (id: string, params?: { page?: number; pageSize?: number }) =>
    api
      .get<Paginated<unknown>>(`/api/users/${id}/activity`, { params })
      .then((r) => r.data),
  permissions: (id: string, projectId?: string) =>
    api
      .get<EffectivePermissions>(`/api/users/${id}/permissions`, {
        params: projectId ? { projectId } : undefined,
      })
      .then((r) => r.data),
  delete: (id: string) => api.delete(`/api/users/${id}`),
};
