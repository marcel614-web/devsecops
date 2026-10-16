// apps/api/src/modules/pipelines/pipelines.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as pipelinesController from "./pipelines.controller";
import {
  pipelineListQuerySchema,
  pipelineLogsQuerySchema,
  pipelineScansQuerySchema,
  projectIdParamSchema,
  projectPipelineParamSchema,
  runPipelineSchema,
} from "./pipelines.schema";

export const pipelinesRouter = Router({ mergeParams: true });

pipelinesRouter.use(requireAuth);

pipelinesRouter.get(
  "/",
  validate({ params: projectIdParamSchema, query: pipelineListQuerySchema }),
  pipelinesController.listPipelines,
);

pipelinesRouter.post(
  "/run",
  validate({ params: projectIdParamSchema, body: runPipelineSchema }),
  pipelinesController.runPipeline,
);

pipelinesRouter.get(
  "/:id",
  validate({ params: projectPipelineParamSchema }),
  pipelinesController.getPipeline,
);

// Nouveaux endpoints
pipelinesRouter.get(
  "/:id/logs",
  validate({ params: projectPipelineParamSchema, query: pipelineLogsQuerySchema }),
  pipelinesController.getPipelineLogs,
);

pipelinesRouter.get(
  "/:id/logs/download",
  validate({ params: projectPipelineParamSchema }),
  pipelinesController.downloadPipelineLogs,
);

pipelinesRouter.get(
  "/:id/scans",
  validate({ params: projectPipelineParamSchema, query: pipelineScansQuerySchema }),
  pipelinesController.getPipelineScans,
);

pipelinesRouter.get(
  "/:id/report",
  validate({ params: projectPipelineParamSchema }),
  pipelinesController.getPipelineReport,
);

pipelinesRouter.post(
  "/:id/cancel",
  validate({ params: projectPipelineParamSchema }),
  pipelinesController.cancelPipeline,
);

pipelinesRouter.delete(
  "/:id",
  validate({ params: projectPipelineParamSchema }),
  pipelinesController.deletePipeline,
);