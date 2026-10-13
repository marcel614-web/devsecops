// apps/web/src/hooks/useDashboard.ts
import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "@/services/dashboard.service";

export function useDashboardSummary(refetchMs = 15_000) {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardService.summary,
    refetchInterval: refetchMs,
  });
}