-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'MAINTAINER', 'DEVELOPER', 'SECURITY_ANALYST', 'REPORTER', 'GUEST');

-- CreateEnum
CREATE TYPE "ProjectMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "PermissionScopeType" AS ENUM ('GLOBAL', 'PROJECT');

-- CreateEnum
CREATE TYPE "SpecialPermission" AS ENUM ('APPROVE_PRODUCTION', 'MANAGE_SECURITY_POLICY', 'MANAGE_SERVERS', 'MANAGE_INTEGRATIONS', 'MANAGE_PROJECT_MEMBERS', 'MANAGE_GITHUB_TEAMS', 'ACCEPT_SECURITY_RISK', 'MANAGE_DEPLOYMENTS', 'MANAGE_PROJECT_SECRETS', 'VIEW_SECURITY_AUDIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "origin" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "result" TEXT NOT NULL DEFAULT 'SUCCESS';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "triggeredById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "username" TEXT,
ALTER COLUMN "role" SET DEFAULT 'PLATFORM_USER';

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'GUEST',
    "status" "ProjectMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "SpecialPermission" NOT NULL,
    "scopeType" "PermissionScopeType" NOT NULL,
    "scopeId" TEXT,
    "grantedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_role_idx" ON "ProjectMember"("role");

-- CreateIndex
CREATE INDEX "ProjectMember_status_idx" ON "ProjectMember"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_tokenHash_key" ON "ProjectInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectInvitation_projectId_email_idx" ON "ProjectInvitation"("projectId", "email");

-- CreateIndex
CREATE INDEX "ProjectInvitation_email_idx" ON "ProjectInvitation"("email");

-- CreateIndex
CREATE INDEX "ProjectInvitation_expiresAt_idx" ON "ProjectInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "ProjectInvitation_revokedAt_idx" ON "ProjectInvitation"("revokedAt");

-- CreateIndex
CREATE INDEX "PermissionGrant_userId_permission_scopeType_scopeId_idx" ON "PermissionGrant"("userId", "permission", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "PermissionGrant_scopeType_scopeId_idx" ON "PermissionGrant"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "PermissionGrant_expiresAt_idx" ON "PermissionGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "PermissionGrant_revokedAt_idx" ON "PermissionGrant"("revokedAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_result_idx" ON "AuditLog"("result");

-- CreateIndex
CREATE INDEX "Pipeline_triggeredById_idx" ON "Pipeline"("triggeredById");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================
-- DATA MIGRATION : rôles globaux et appartenances historiques
-- ============================================================

-- ADMIN -> PLATFORM_ADMIN ; DEVELOPER -> PLATFORM_USER.
UPDATE "User" SET "role" = 'PLATFORM_ADMIN' WHERE "role" = 'ADMIN';
UPDATE "User" SET "role" = 'PLATFORM_USER'  WHERE "role" = 'DEVELOPER';

-- Le statut est dérivé de l'ancien booléen isActive. Les comptes inactifs
-- historiques sont marqués PENDING (activation administrateur requise).
UPDATE "User" SET "status" = 'ACTIVE' WHERE "isActive" = true;
UPDATE "User" SET "status" = 'PENDING' WHERE "isActive" = false;

-- Chaque projet existant conserve son propriétaire comme OWNER explicite.
-- Aucun autre utilisateur ne reçoit de rôle : les autres appartenances
-- nécessiteront une invitation/attribution manuelle.
INSERT INTO "ProjectMember" ("id", "userId", "projectId", "role", "status", "createdAt", "updatedAt")
SELECT
  'legacy_owner_' || p."id",
  p."ownerId",
  p."id",
  'OWNER',
  'ACTIVE',
  NOW(),
  NOW()
FROM "Project" p
WHERE NOT EXISTS (
  SELECT 1 FROM "ProjectMember" m
  WHERE m."projectId" = p."id" AND m."userId" = p."ownerId"
);

-- Les anciennes valeurs d'enum restent présentes pour compatibilité, mais
-- plus aucun compte ne doit les utiliser.
