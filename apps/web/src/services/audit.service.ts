import { api } from "./api";

export const auditService = {
  list: (params?: { page?: number; pageSize?: number; action?: string; targetType?: string; search?: string }) =>
    api.get("/api/audit-logs", { params }).then((r) => r.data),
};