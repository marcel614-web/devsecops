// apps/web/src/services/dashboard.service.ts
import { api } from "./api";
import type { DashboardSummary } from "@/types/api";

export const dashboardService = {
  summary: () =>
    api.get<DashboardSummary>("/api/dashboard/summary").then((r) => r.data),
};