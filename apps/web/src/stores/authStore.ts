import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "DEVELOPER";
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
  setLoading: (v: boolean) => void;
  logout: () => void;
}

// ⚠️ PHASE 2 : placeholder sans appel API.
// En Phase 3 on branchera les vraies requêtes /api/auth.
export const useAuthStore = create<AuthState>((set) => ({
  user: {
    id: "demo",
    email: "demo@devsecops.local",
    name: "Utilisateur Démo",
    role: "ADMIN",
  },
  loading: false,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  logout: () => set({ user: null }),
}));