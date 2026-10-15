import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as deploymentsController from "./deployments.controller";
import { deploymentIdParamSchema } from "./deployments.schema";

export const deploymentsRouter = Router();

deploymentsRouter.use(requireAuth);

deploymentsRouter.get("/", deploymentsController.listDeployments);

deploymentsRouter.get(
  "/:id",
  validate({ params: deploymentIdParamSchema }),
  deploymentsController.getDeployment,
);

deploymentsRouter.post(
  "/:id/start",
  validate({ params: deploymentIdParamSchema }),
  deploymentsController.startDeployment,
);

deploymentsRouter.post(
  "/:id/stop",
  validate({ params: deploymentIdParamSchema }),
  deploymentsController.stopDeployment,
);

deploymentsRouter.post(
  "/:id/restart",
  validate({ params: deploymentIdParamSchema }),
  deploymentsController.restartDeployment,
);

deploymentsRouter.delete(
  "/:id",
  validate({ params: deploymentIdParamSchema }),
  deploymentsController.uninstallDeployment,
);