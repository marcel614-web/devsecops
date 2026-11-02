import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as deploymentsController from "./deployments.controller";
import { deploymentIdParamSchema } from "./deployments.schema";
import {
  approvalDecisionSchema,
  approvalIdParamSchema,
  approvalListQuerySchema,
} from "./approvals.schema";

export const deploymentsRouter = Router();

deploymentsRouter.use(requireAuth);

deploymentsRouter.get("/", deploymentsController.listDeployments);

// Les routes d'approbation sont déclarées AVANT /:id pour ne pas être
// capturées par le paramètre générique.
deploymentsRouter.get(
  "/approvals",
  validate({ query: approvalListQuerySchema }),
  deploymentsController.listApprovals,
);

deploymentsRouter.post(
  "/approvals/:id/decision",
  validate({
    params: approvalIdParamSchema,
    body: approvalDecisionSchema,
  }),
  deploymentsController.decideApproval,
);

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