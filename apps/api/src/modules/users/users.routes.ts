// apps/api/src/modules/users/users.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as usersController from "./users.controller";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
  userListQuerySchema,
} from "./users.schema";

export const usersRouter = Router();

// Toutes les routes exigent un utilisateur authentifié.
usersRouter.use(requireAuth);

// Lecture d'un utilisateur : ADMIN ou l'utilisateur lui-même (vérifié dans le service).
usersRouter.get(
  "/:id",
  validate({ params: userIdParamSchema }),
  usersController.getUser,
);

// Actions réservées aux ADMIN
usersRouter.get(
  "/",
  requireRole("ADMIN"),
  validate({ query: userListQuerySchema }),
  usersController.listUsers,
);

usersRouter.post(
  "/",
  requireRole("ADMIN"),
  validate({ body: createUserSchema }),
  usersController.createUser,
);

usersRouter.patch(
  "/:id",
  requireRole("ADMIN"),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  usersController.updateUser,
);

usersRouter.delete(
  "/:id",
  requireRole("ADMIN"),
  validate({ params: userIdParamSchema }),
  usersController.deleteUser,
);