import { api } from "./api";

export const auditService = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    action?: string;
    category?: string;
    targetType?: string;
    userId?: string;
    search?: string;
    from?: string;
    to?: string;
  }) => api.get("/api/audit-logs", { params }).then((r) => r.data),
};