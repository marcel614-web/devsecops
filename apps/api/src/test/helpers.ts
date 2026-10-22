// apps/api/src/test/helpers.ts
import { Role } from "@prisma/client";
import argon2 from "argon2";
import { prisma } from "../utils/prisma";
import { env } from "../config/env";

/**
 * Utilitaires partagés par les tests d'intégration.
 *
 * Les tests s'exécutent contre la base `devsecops_test` (cf. `setup.ts`).
 * On nettoie les tables entre chaque suite pour garantir l'isolation.
 */

/** Mot de passe conforme à la politique (12 min, maj/min/chiffre/symbole). */
export const VALID_PASSWORD = "TestPassword!2024";

/**
 * Supprime toutes les lignes des tables métier.
 * L'ordre respecte les dépendances FK.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.securityGateException.deleteMany(),
    prisma.securityGateResult.deleteMany(),
    prisma.sbom.deleteMany(),
    prisma.dockerImage.deleteMany(),
    prisma.securityReport.deleteMany(),
    prisma.vulnerability.deleteMany(),
    prisma.securityScan.deleteMany(),
    prisma.pipelineLog.deleteMany(),
    prisma.pipelineStep.deleteMany(),
    prisma.pipeline.deleteMany(),
    prisma.deployment.deleteMany(),
    prisma.projectConfiguration.deleteMany(),
    prisma.project.deleteMany(),
    prisma.deploymentServer.deleteMany(),
    prisma.gitHubRepository.deleteMany(),
    prisma.gitHubInstallation.deleteMany(),
    prisma.systemConfig.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  name: string;
}

/** Crée un utilisateur (actif par défaut). */
export async function createUser(
  overrides: Partial<{
    email: string;
    password: string;
    role: Role;
    name: string;
    isActive: boolean;
  }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? "user@test.local";
  const password = overrides.password ?? VALID_PASSWORD;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  const user = await prisma.user.create({
    data: {
      email,
      name: overrides.name ?? "Utilisateur Test",
      passwordHash,
      role: overrides.role ?? Role.DEVELOPER,
      isActive: overrides.isActive ?? true,
    },
    select: { id: true, email: true, role: true, name: true },
  });

  return { ...user, password };
}

/** Crée un projet appartenant à `ownerId`, avec sa configuration par défaut. */
export async function createProject(ownerId: string, overrides: Partial<{
  name: string;
  repoFullName: string;
  defaultBranch: string;
}> = {}) {
  const repoFullName = overrides.repoFullName ?? "acme/demo";
  return prisma.project.create({
    data: {
      ownerId,
      name: overrides.name ?? "Projet Test",
      repoFullName,
      repoId: "123456",
      defaultBranch: overrides.defaultBranch ?? "main",
      config: {
        create: {
          triggerBranches: ["main"],
        },
      },
    },
    select: { id: true, name: true, repoFullName: true, ownerId: true },
  });
}
