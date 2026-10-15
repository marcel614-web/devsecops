import { api } from "./api";

export const reportService = {
  list: (params?: { page?: number; pageSize?: number; projectId?: string }) =>
    api.get("/api/reports", { params }).then((r) => r.data),
  get: (id: string) => api.get(`/api/reports/${id}`).then((r) => r.data.report),
};