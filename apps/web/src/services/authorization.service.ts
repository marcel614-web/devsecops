import { api } from "./api";
import type {
  AuthorizationCatalog,
  PermissionGrant,
  SpecialPermission,
} from "@/types/api";

export const authorizationService = {
  catalog: () =>
    api
      .get<AuthorizationCatalog>("/api/authorization/catalog")
      .then((r) => r.data),
  globalGrants: () =>
    api
      .get<{ grants: PermissionGrant[] }>("/api/authorization/global-permissions")
      .then((r) => r.data.grants),
  grantGlobal: (data: {
    userId: string;
    permission: SpecialPermission;
    scopeType: "GLOBAL";
    expiresAt?: string | null;
  }) =>
    api
      .post<{ grant: PermissionGrant }>(
        "/api/authorization/global-permissions",
        data,
      )
      .then((r) => r.data.grant),
  revokeGlobal: (grantId: string) =>
    api.delete(`/api/authorization/global-permissions/${grantId}`),
};
