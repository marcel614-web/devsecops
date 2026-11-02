// apps/web/src/services/verification.service.ts
import { api } from "./api";
import type { DeploymentVerification, Paginated } from "@/types/api";

export const verificationService = {
  list: (
    projectId: string,
    params?: { page?: number; pageSize?: number },
  ) =>
    api
      .get<Paginated<DeploymentVerification>>(
        `/api/projects/${projectId}/verifications`,
        { params },
      )
      .then((r) => r.data),
};
