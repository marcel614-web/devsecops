// apps/web/src/services/auth.service.ts
import { api } from "./api";
import type { Role, UserStatus } from "@/types/api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status?: UserStatus;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Permissions globales effectives, utilisées uniquement pour la navigation. */
  globalPermissions?: string[];
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

/**
 * L'inscription ne délivre volontairement aucun jeton : le compte est
 * inactif jusqu'à validation par un administrateur.
 */
export interface RegisterResponse {
  user: AuthUser;
  isActive: boolean;
  message: string;
}

export const authService = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>("/api/auth/login", { email, password }).then((r) => r.data),

  register: (email: string, password: string, name: string) =>
    api.post<RegisterResponse>("/api/auth/register", { email, password, name }).then((r) => r.data),

  logout: () => api.post("/api/auth/logout"),

  me: () => api.get<{ user: AuthUser }>("/api/auth/me").then((r) => r.data.user),

  updateProfile: (data: { name?: string; email?: string }) =>
    api.patch<{ user: AuthUser }>("/api/auth/me", data).then((r) => r.data.user),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post("/api/auth/change-password", { currentPassword, newPassword }),

  /** Invalide toutes les sessions (y compris la session courante). */
  revokeAllSessions: () => api.post("/api/auth/sessions/revoke-all"),
};