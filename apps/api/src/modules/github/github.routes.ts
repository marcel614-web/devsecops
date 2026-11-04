// apps/api/src/modules/github/github.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { requireGlobalPermission } from "../authorization/authorization.middleware";
import { PERMISSIONS } from "../authorization/permissions.constants";
import * as githubController from "./github.controller";
import * as teamsController from "./teams.controller";
import {
  addMemberSchema,
  associateTeamProjectSchema,
  createTeamSchema,
  installationParamSchema,
  listMembersQuerySchema,
  listReposQuerySchema,
  listTeamsQuerySchema,
  setRepoPermissionSchema,
  teamMemberParamSchema,
  teamParamSchema,
  teamProjectLinkParamSchema,
  teamRepoParamSchema,
  updateProjectTeamRoleSchema,
} from "./teams.schema";

export const githubRouter = Router();

// ------------------------------------------------------------
// PUBLIC : callback setup d'installation (vérifié via state signé)
// ------------------------------------------------------------
githubRouter.get("/setup/callback", githubController.setupCallback);

// ------------------------------------------------------------
// PROTÉGÉ : JWT obligatoire
// ------------------------------------------------------------
githubRouter.use(requireAuth);

// Démarrage du flux d'installation
githubRouter.get("/install/start", githubController.startInstall);

// Installations
githubRouter.get("/installations", githubController.listInstallations);
githubRouter.post("/installations/:id/sync", githubController.syncInstallation);
githubRouter.delete("/installations/:id", githubController.revokeInstallation);

// Repositories
githubRouter.get("/repositories", githubController.listRepositories);
githubRouter.get(
  "/repositories/:id/branch-protection",
  githubController.getBranchProtection,
);
githubRouter.get("/repositories/:id", githubController.getRepository);
githubRouter.get("/repositories/:id/branches", githubController.listBranches);
githubRouter.get("/repositories/:id/commits", githubController.listCommits);

// ------------------------------------------------------------
// ORGANISATIONS GITHUB (équipes disponibles uniquement pour les orgs)
// ------------------------------------------------------------
githubRouter.get("/organizations", teamsController.listOrganizations);
githubRouter.post(
  "/organizations/:installationId/sync",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: installationParamSchema }),
  teamsController.syncOrganization,
);

// ------------------------------------------------------------
// ÉQUIPES
// ------------------------------------------------------------
githubRouter.get(
  "/organizations/:installationId/teams",
  validate({ params: installationParamSchema, query: listTeamsQuerySchema }),
  teamsController.listTeams,
);

githubRouter.post(
  "/organizations/:installationId/teams",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: installationParamSchema, body: createTeamSchema }),
  teamsController.createTeam,
);

githubRouter.get(
  "/organizations/:installationId/teams/:slug",
  validate({ params: teamParamSchema }),
  teamsController.getTeam,
);

githubRouter.post(
  "/organizations/:installationId/teams/:slug/sync",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: teamParamSchema }),
  teamsController.syncTeam,
);

// ------------------------------------------------------------
// MEMBRES
// ------------------------------------------------------------
githubRouter.get(
  "/organizations/:installationId/teams/:slug/members",
  validate({ params: teamParamSchema, query: listMembersQuerySchema }),
  teamsController.listMembers,
);

githubRouter.put(
  "/organizations/:installationId/teams/:slug/members/:username",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: teamMemberParamSchema, body: addMemberSchema }),
  teamsController.addMember,
);

githubRouter.delete(
  "/organizations/:installationId/teams/:slug/members/:username",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: teamMemberParamSchema }),
  teamsController.removeMember,
);

// ------------------------------------------------------------
// DÉPÔTS ASSOCIÉS À L'ÉQUIPE
// ------------------------------------------------------------
githubRouter.get(
  "/organizations/:installationId/teams/:slug/repos",
  validate({ params: teamParamSchema, query: listReposQuerySchema }),
  teamsController.listTeamRepos,
);

githubRouter.get(
  "/organizations/:installationId/teams/:slug/available-repos",
  validate({ params: teamParamSchema }),
  teamsController.listAvailableRepos,
);

githubRouter.put(
  "/organizations/:installationId/teams/:slug/repos/:owner/:repo",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: teamRepoParamSchema, body: setRepoPermissionSchema }),
  teamsController.setRepoPermission,
);

githubRouter.delete(
  "/organizations/:installationId/teams/:slug/repos/:owner/:repo",
  requireGlobalPermission(PERMISSIONS.GITHUB_TEAM_MANAGE),
  validate({ params: teamRepoParamSchema }),
  teamsController.removeTeamRepo,
);

// ------------------------------------------------------------
// ASSOCIATIONS ÉQUIPE → PROJET (vue équipe)
// ------------------------------------------------------------
githubRouter.get(
  "/organizations/:installationId/teams/:slug/projects",
  validate({ params: teamParamSchema }),
  teamsController.listTeamProjects,
);

githubRouter.post(
  "/organizations/:installationId/teams/:slug/projects",
  validate({ params: teamParamSchema, body: associateTeamProjectSchema }),
  teamsController.associateTeamProject,
);

githubRouter.patch(
  "/organizations/:installationId/teams/:slug/projects/:linkId",
  validate({ params: teamProjectLinkParamSchema, body: updateProjectTeamRoleSchema }),
  teamsController.updateTeamProjectRole,
);

githubRouter.delete(
  "/organizations/:installationId/teams/:slug/projects/:linkId",
  validate({ params: teamProjectLinkParamSchema }),
  teamsController.removeTeamProject,
);
