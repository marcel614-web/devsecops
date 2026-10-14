// apps/api/src/modules/projects/projects.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as projectsController from "./projects.controller";
import {
  createProjectSchema,
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