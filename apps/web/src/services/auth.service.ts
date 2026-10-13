// apps/web/src/services/auth.service.ts
import { api } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "DEVELOPER";
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

export const authService = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>("/api/auth/login", { email, password }).then((r) => r.data),

  register: (email: string, password: string, name: string) =>
    api.post<AuthResponse>("/api/auth/register", { email, password, name }).then((r) => r.data),

  logout: () => api.post("/api/auth/logout"),

  me: () => api.get<{ user: AuthUser }>("/api/auth/me").then((r) => r.data.user),

  updateProfile: (data: { name?: string; email?: string }) =>
    api.patch<{ user: AuthUser }>("/api/auth/me", data).then((r) => r.data.user),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post("/api/auth/change-password", { currentPassword, newPassword }),
};