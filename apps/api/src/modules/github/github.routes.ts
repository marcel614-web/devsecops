// apps/api/src/modules/github/github.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import * as githubController from "./github.controller";

export const githubRouter = Router();

// ------------------------------------------------------------
// PUBLIC : callback setup d'installation (vérifié via state signé)
// ------------------------------------------------------------
githubRouter.get("/setup/callback", githubController.setupCallback);

// ------------------------------------------------------------
// PROTÉGÉ : JWT obligatoire
// ------------------------------------------------------------
githubRouter.use(requireAuth);

// Démarrage du flux d'installation
githubRouter.get("/install/start", githubController.startInstall);

// Installations
githubRouter.get("/installations", githubController.listInstallations);
githubRouter.post("/installations/:id/sync", githubController.syncInstallation);
githubRouter.delete("/installations/:id", githubController.revokeInstallation);

// Repositories
githubRouter.get("/repositories", githubController.listRepositories);
githubRouter.get(
  "/repositories/:id/branch-protection",
  githubController.getBranchProtection,
);
githubRouter.get("/repositories/:id", githubController.getRepository);
githubRouter.get("/repositories/:id/branches", githubController.listBranches);
githubRouter.get("/repositories/:id/commits", githubController.listCommits);