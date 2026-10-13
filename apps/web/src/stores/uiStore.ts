import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: localStorage.getItem("sidebarCollapsed") === "true",
  sidebarMobileOpen: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    localStorage.setItem("sidebarCollapsed", String(next));
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (v) => {
    localStorage.setItem("sidebarCollapsed", String(v));
    set({ sidebarCollapsed: v });
  },
  toggleMobileSidebar: () => set({ sidebarMobileOpen: !get().sidebarMobileOpen }),
  closeMobileSidebar: () => set({ sidebarMobileOpen: false }),
}));