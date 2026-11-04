// apps/api/src/modules/projects/projects.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { deploymentListQuerySchema } from "../deployments/deployments.schema";
import * as deploymentsController from "../deployments/deployments.controller";
import * as projectsController from "./projects.controller";
import * as projectMembersController from "./project-members.controller";
import {
  acceptInvitationSchema,
  grantSpecialPermissionSchema,
  inviteProjectMemberSchema,
  projectInvitationParamSchema,
  projectMemberParamSchema,
  revokeSpecialPermissionParamSchema,
  updateProjectMemberRoleSchema,
} from "./project-members.schema";
import * as projectTeamsController from "../github/project-teams.controller";
import {
  associateProjectTeamSchema,
  projectTeamLinkParamSchema,
  updateProjectTeamRoleSchema,
} from "../github/teams.schema";
import {
  createGateExceptionSchema,
  createProjectSchema,
  gateExceptionDecisionSchema,
  gateExceptionParamSchema,
  projectIdParamSchema,
  projectListQuerySchema,
  updateProjectConfigSchema,
  updateProjectSchema,
} from "./projects.schema";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

// ------------------------------------------------------------
// CRUD projets
// ------------------------------------------------------------
projectsRouter.get(
  "/",
  validate({ query: projectListQuerySchema }),
  projectsController.listProjects,
);

projectsRouter.post(
  "/",
  validate({ body: createProjectSchema }),
  projectsController.createProject,
);

projectsRouter.get(
  "/:id",
  validate({ params: projectIdParamSchema }),
  projectsController.getProject,
);

projectsRouter.patch(
  "/:id",
  validate({ params: projectIdParamSchema, body: updateProjectSchema }),
  projectsController.updateProject,
);

projectsRouter.delete(
  "/:id",
  validate({ params: projectIdParamSchema }),
  projectsController.deleteProject,
);

// ------------------------------------------------------------
// Membres, invitations et permissions spéciales du projet
// ------------------------------------------------------------
projectsRouter.get(
  "/:id/members",
  validate({ params: projectIdParamSchema }),
  projectMembersController.listMembers,
);

projectsRouter.get(
  "/:id/members/:memberId/permissions",
  validate({ params: projectMemberParamSchema }),
  projectMembersController.getMemberPermissions,
);

projectsRouter.patch(
  "/:id/members/:memberId",
  validate({
    params: projectMemberParamSchema,
    body: updateProjectMemberRoleSchema,
  }),
  projectMembersController.updateMemberRole,
);

projectsRouter.delete(
  "/:id/members/:memberId",
  validate({ params: projectMemberParamSchema }),
  projectMembersController.removeMember,
);

projectsRouter.get(
  "/:id/invitations",
  validate({ params: projectIdParamSchema }),
  projectMembersController.listInvitations,
);

projectsRouter.post(
  "/:id/invitations",
  validate({
    params: projectIdParamSchema,
    body: inviteProjectMemberSchema,
  }),
  projectMembersController.inviteMember,
);

projectsRouter.post(
  "/:id/invitations/:invitationId/resend",
  validate({ params: projectInvitationParamSchema }),
  projectMembersController.resendInvitation,
);

projectsRouter.delete(
  "/:id/invitations/:invitationId",
  validate({ params: projectInvitationParamSchema }),
  projectMembersController.revokeInvitation,
);

projectsRouter.get(
  "/:id/permission-grants",
  validate({ params: projectIdParamSchema }),
  projectMembersController.listPermissionGrants,
);

projectsRouter.post(
  "/:id/permission-grants",
  validate({
    params: projectIdParamSchema,
    body: grantSpecialPermissionSchema,
  }),
  projectMembersController.grantPermission,
);

projectsRouter.delete(
  "/:id/permission-grants/:grantId",
  validate({
    params: projectIdParamSchema.extend({
      grantId: revokeSpecialPermissionParamSchema.shape.grantId,
    }),
  }),
  projectMembersController.revokePermission,
);

// Route publique-authentifiée d'acceptation d'invitation.
projectsRouter.post(
  "/invitations/accept",
  validate({ body: acceptInvitationSchema }),
  projectMembersController.acceptInvitation,
);

// Déploiements du projet (utilisé par le filtre de la page Déploiements).
projectsRouter.get(
  "/:id/deployments",
  validate({
    params: projectIdParamSchema,
    query: deploymentListQuerySchema,
  }),
  deploymentsController.listProjectDeployments,
);

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
projectsRouter.get(
  "/:id/config",
  validate({ params: projectIdParamSchema }),
  projectsController.getProjectConfig,
);

projectsRouter.patch(
  "/:id/config",
  validate({ params: projectIdParamSchema, body: updateProjectConfigSchema }),
  projectsController.updateProjectConfig,
);

// ------------------------------------------------------------
// Exceptions de Security Gate
// ------------------------------------------------------------
projectsRouter.get(
  "/:id/gate-exceptions",
  validate({ params: projectIdParamSchema }),
  projectsController.listGateExceptions,
);

projectsRouter.post(
  "/:id/gate-exceptions",
  validate({ params: projectIdParamSchema, body: createGateExceptionSchema }),
  projectsController.createGateException,
);

projectsRouter.get(
  "/:id/gate-exceptions/:exceptionId",
  validate({ params: gateExceptionParamSchema }),
  projectsController.getGateException,
);

projectsRouter.post(
  "/:id/gate-exceptions/:exceptionId/decision",
  validate({
    params: gateExceptionParamSchema,
    body: gateExceptionDecisionSchema,
  }),
  projectsController.decideGateException,
);

projectsRouter.delete(
  "/:id/gate-exceptions/:exceptionId",
  validate({ params: gateExceptionParamSchema }),
  projectsController.deleteGateException,
);

// ------------------------------------------------------------
// Association repository GitHub
// ------------------------------------------------------------
projectsRouter.post(
  "/:id/repository",
  validate({ params: projectIdParamSchema }),
  projectsController.associateRepository,
);

projectsRouter.delete(
  "/:id/repository",
  validate({ params: projectIdParamSchema }),
  projectsController.detachRepository,
);

// ------------------------------------------------------------
// Association d'équipes GitHub (rôle interne au projet)
// ------------------------------------------------------------
projectsRouter.get(
  "/:id/teams/available",
  validate({ params: projectIdParamSchema }),
  projectTeamsController.listAvailableTeams,
);

projectsRouter.get(
  "/:id/teams",
  validate({ params: projectIdParamSchema }),
  projectTeamsController.listProjectTeams,
);

projectsRouter.post(
  "/:id/teams",
  validate({
    params: projectIdParamSchema,
    body: associateProjectTeamSchema,
  }),
  projectTeamsController.associateProjectTeam,
);

projectsRouter.patch(
  "/:id/teams/:linkId",
  validate({
    params: projectTeamLinkParamSchema,
    body: updateProjectTeamRoleSchema,
  }),
  projectTeamsController.updateProjectTeamRole,
);

projectsRouter.delete(
  "/:id/teams/:linkId",
  validate({ params: projectTeamLinkParamSchema }),
  projectTeamsController.removeProjectTeam,
);