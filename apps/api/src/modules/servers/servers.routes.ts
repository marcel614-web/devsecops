// apps/api/src/modules/servers/servers.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as serversController from "./servers.controller";
import {
  createServerSchema,
  serverIdParamSchema,
  serverListQuerySchema,
  trustHostKeySchema,
  updateServerSchema,
} from "./servers.schema";

export const serversRouter = Router();

serversRouter.use(requireAuth);

serversRouter.get(
  "/",
  validate({ query: serverListQuerySchema }),
  serversController.listServers,
);

serversRouter.post(
  "/",
  validate({ body: createServerSchema }),
  serversController.createServer,
);

serversRouter.get(
  "/:id/resources",
  validate({ params: serverIdParamSchema }),
  serversController.getServerResources,
);

serversRouter.get(
  "/:id",
  validate({ params: serverIdParamSchema }),
  serversController.getServer,
);

serversRouter.patch(
  "/:id",
  validate({ params: serverIdParamSchema, body: updateServerSchema }),
  serversController.updateServer,
);



serversRouter.delete(
  "/:id",
  validate({ params: serverIdParamSchema }),
  serversController.deleteServer,
);

serversRouter.post(
  "/:id/test",
  validate({ params: serverIdParamSchema }),
  serversController.testServer,
);

serversRouter.put(
  "/:id/host-key",
  validate({ params: serverIdParamSchema, body: trustHostKeySchema }),
  serversController.trustHostKey,
);

serversRouter.post(
  "/:id/cleanup-images",
  validate({ params: serverIdParamSchema }),
  serversController.cleanupDockerImages,
);