// apps/api/src/modules/users/users.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  requirePlatformAdminMiddleware,
} from "../authorization/authorization.middleware";
import * as usersController from "./users.controller";
import {
  createUserSchema,
  effectivePermissionsQuerySchema,
  updateUserSchema,
  userActivityQuerySchema,
  userIdParamSchema,
  userListQuerySchema,
} from "./users.schema";

export const usersRouter = Router();

// Toutes les routes exigent un utilisateur authentifié.
usersRouter.use(requireAuth);

// Lecture d'un utilisateur : PLATFORM_ADMIN ou l'utilisateur lui-même
// (la règle est revérifiée dans le service).
usersRouter.get(
  "/:id/permissions",
  validate({
    params: userIdParamSchema,
    query: effectivePermissionsQuerySchema,
  }),
  usersController.getUserPermissions,
);

usersRouter.get(
  "/:id/activity",
  requirePlatformAdminMiddleware(),
  validate({ params: userIdParamSchema, query: userActivityQuerySchema }),
  usersController.getUserActivity,
);

usersRouter.get(
  "/:id",
  validate({ params: userIdParamSchema }),
  usersController.getUser,
);

// Actions réservées aux administrateurs de la plateforme.
usersRouter.get(
  "/",
  requirePlatformAdminMiddleware(),
  validate({ query: userListQuerySchema }),
  usersController.listUsers,
);

usersRouter.post(
  "/",
  requirePlatformAdminMiddleware(),
  validate({ body: createUserSchema }),
  usersController.createUser,
);

usersRouter.patch(
  "/:id",
  requirePlatformAdminMiddleware(),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  usersController.updateUser,
);

usersRouter.delete(
  "/:id",
  requirePlatformAdminMiddleware(),
  validate({ params: userIdParamSchema }),
  usersController.deleteUser,
);

usersRouter.post(
  "/:id/suspend",
  requirePlatformAdminMiddleware(),
  validate({ params: userIdParamSchema }),
  usersController.suspendUser,
);

usersRouter.post(
  "/:id/reactivate",
  requirePlatformAdminMiddleware(),
  validate({ params: userIdParamSchema }),
  usersController.reactivateUser,
);

usersRouter.post(
  "/:id/revoke-sessions",
  requirePlatformAdminMiddleware(),
  validate({ params: userIdParamSchema }),
  usersController.revokeSessions,
);
