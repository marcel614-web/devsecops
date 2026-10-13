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

// Toutes les routes exigent un utilisateur authentifié.
projectsRouter.use(requireAuth);

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