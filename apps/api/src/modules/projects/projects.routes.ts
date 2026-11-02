// apps/api/src/modules/projects/projects.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { deploymentListQuerySchema } from "../deployments/deployments.schema";
import * as deploymentsController from "../deployments/deployments.controller";
import * as projectsController from "./projects.controller";
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