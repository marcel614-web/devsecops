import { api } from "./api";
import type { AuthResponse, User } from "@/types/api";

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>("/api/auth/login", { email, password }).then((r) => r.data),

  register: (email: string, password: string, name: string) =>
    api.post<AuthResponse>("/api/auth/register", { email, password, name }).then((r) => r.data),

  logout: () => api.post("/api/auth/logout"),

  me: () => api.get<{ user: User }>("/api/auth/me").then((r) => r.data.user),
};