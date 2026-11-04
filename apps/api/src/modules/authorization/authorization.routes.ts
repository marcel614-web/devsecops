// apps/api/src/modules/authorization/authorization.routes.ts
import { Router } from "express";
import { SpecialPermission } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  grantGlobalSpecialPermissionSchema,
  revokeSpecialPermissionParamSchema,
} from "../projects/project-members.schema";
import * as projectMembersController from "../projects/project-members.controller";
import {
  PERMISSIONS,
  PROJECT_SCOPED_SPECIAL_PERMISSIONS,
  GLOBAL_ONLY_SPECIAL_PERMISSIONS,
  SPECIAL_PERMISSION_CAPABILITIES,
} from "./permissions.constants";
import {
  GLOBAL_ROLE_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  PROJECT_ROLE_LABELS,
} from "./role-permissions";

export const authorizationRouter = Router();

authorizationRouter.use(requireAuth);

const GLOBAL_ROLE_LABELS = {
  PLATFORM_ADMIN: "Administrateur de la plateforme",
  PLATFORM_USER: "Utilisateur de la plateforme",
} as const;

const SPECIAL_PERMISSION_LABELS: Record<SpecialPermission, string> = {
  [SpecialPermission.APPROVE_PRODUCTION]: "Approuver une production",
  [SpecialPermission.MANAGE_SECURITY_POLICY]: "Gérer la politique de sécurité",
  [SpecialPermission.MANAGE_SERVERS]: "Gérer les serveurs",
  [SpecialPermission.MANAGE_INTEGRATIONS]: "Gérer les intégrations",
  [SpecialPermission.MANAGE_PROJECT_MEMBERS]: "Gérer les membres du projet",
  [SpecialPermission.MANAGE_GITHUB_TEAMS]: "Gérer les équipes GitHub",
  [SpecialPermission.ACCEPT_SECURITY_RISK]: "Accepter un risque sécurité",
  [SpecialPermission.MANAGE_DEPLOYMENTS]: "Gérer les déploiements",
  [SpecialPermission.MANAGE_PROJECT_SECRETS]: "Gérer les secrets du projet",
  [SpecialPermission.VIEW_SECURITY_AUDIT]: "Consulter l'audit sécurité",
};

const SPECIAL_PERMISSION_DESCRIPTIONS: Record<SpecialPermission, string> = {
  [SpecialPermission.APPROVE_PRODUCTION]:
    "Autorise l'approbation d'une promotion en production, y compris sa propre livraison.",
  [SpecialPermission.MANAGE_SECURITY_POLICY]:
    "Autorise la modification des règles protégées du Security Gate.",
  [SpecialPermission.MANAGE_SERVERS]:
    "Autorise la gestion de tous les serveurs de déploiement de la plateforme.",
  [SpecialPermission.MANAGE_INTEGRATIONS]:
    "Autorise la configuration des intégrations externes (GitHub, DefectDojo, Dependency-Track).",
  [SpecialPermission.MANAGE_PROJECT_MEMBERS]:
    "Autorise l'invitation, la modification et le retrait des membres du projet.",
  [SpecialPermission.MANAGE_GITHUB_TEAMS]:
    "Autorise l'association et la synchronisation des équipes GitHub du projet.",
  [SpecialPermission.ACCEPT_SECURITY_RISK]:
    "Autorise l'acceptation d'un risque et l'approbation d'une exception de Security Gate.",
  [SpecialPermission.MANAGE_DEPLOYMENTS]:
    "Autorise le lancement, la mise à jour et l'annulation des déploiements.",
  [SpecialPermission.MANAGE_PROJECT_SECRETS]:
    "Autorise la gestion des secrets et variables sensibles du projet.",
  [SpecialPermission.VIEW_SECURITY_AUDIT]:
    "Autorise la consultation de l'audit de sécurité au-delà de ses propres actions.",
};

function scopeFor(permission: SpecialPermission): "GLOBAL" | "PROJECT" | "BOTH" {
  const globalOnly = GLOBAL_ONLY_SPECIAL_PERMISSIONS.has(permission);
  const projectScoped = PROJECT_SCOPED_SPECIAL_PERMISSIONS.has(permission);
  if (globalOnly && projectScoped) return "BOTH";
  if (globalOnly) return "GLOBAL";
  return "PROJECT";
}

authorizationRouter.get("/catalog", (_req, res) => {
  res.json({
    globalRoles: Object.entries(GLOBAL_ROLE_PERMISSIONS).map(
      ([role, permissions]) => ({
        role,
        label: GLOBAL_ROLE_LABELS[role as keyof typeof GLOBAL_ROLE_LABELS],
        permissions: [...permissions].sort(),
      }),
    ),
    projectRoles: Object.entries(PROJECT_ROLE_PERMISSIONS).map(
      ([role, permissions]) => ({
        role,
        label: PROJECT_ROLE_LABELS[role as keyof typeof PROJECT_ROLE_LABELS],
        permissions: [...permissions].sort(),
      }),
    ),
    permissions: Object.values(PERMISSIONS).sort(),
    specialPermissions: Object.values(SpecialPermission).map((permission) => ({
      permission,
      label: SPECIAL_PERMISSION_LABELS[permission],
      description: SPECIAL_PERMISSION_DESCRIPTIONS[permission],
      scope: scopeFor(permission),
      capabilities: SPECIAL_PERMISSION_CAPABILITIES[permission] ?? [],
    })),
  });
});

// Attributions globales : strictement réservées à PLATFORM_ADMIN.
authorizationRouter.get(
  "/global-permissions",
  projectMembersController.listGlobalPermissionGrants,
);

authorizationRouter.post(
  "/global-permissions",
  validate({ body: grantGlobalSpecialPermissionSchema }),
  projectMembersController.grantGlobalPermission,
);

authorizationRouter.delete(
  "/global-permissions/:grantId",
  validate({ params: revokeSpecialPermissionParamSchema }),
  projectMembersController.revokeGlobalPermission,
);
