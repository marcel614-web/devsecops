// apps/web/src/stores/authStore.ts
import { create } from "zustand";
import type { AuthUser } from "@/services/auth.service";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;            // true tant que le bootstrap initial n'est pas terminé
  setUser: (user: AuthUser | null) => void;
  setLoading: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  logout: () => {
    localStorage.removeItem("accessToken");
    set({ user: null });
  },
}));