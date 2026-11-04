// apps/api/src/modules/auth/auth.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";
import { validate } from "../../middleware/validate";
import * as authController from "./auth.controller";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "./auth.schema";

export const authRouter = Router();

authRouter.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  authController.register,
);

authRouter.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  authController.login,
);

authRouter.post("/refresh", authLimiter, authController.refresh);

authRouter.post("/logout", authController.logout);

authRouter.get("/me", requireAuth, authController.me);

authRouter.patch(
  "/me",
  requireAuth,
  validate({ body: updateProfileSchema }),
  authController.updateProfile,
);

authRouter.post(
  "/change-password",
  requireAuth,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

authRouter.post(
  "/sessions/revoke-all",
  requireAuth,
  authController.revokeAllSessions,
);