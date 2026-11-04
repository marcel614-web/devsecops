-- CreateEnum
CREATE TYPE "ProjectTeamRole" AS ENUM ('OWNER', 'MAINTAINER', 'DEVELOPER', 'SECURITY_ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "GitHubTeamSyncState" AS ENUM ('SYNCED', 'DELETED', 'ERROR');

-- AlterTable
ALTER TABLE "GitHubInstallation" ADD COLUMN     "lastOrgSyncedAt" TIMESTAMP(3),
ADD COLUMN     "orgSyncState" TEXT;

-- CreateTable
CREATE TABLE "GitHubTeam" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "githubTeamId" TEXT NOT NULL,
    "orgLogin" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "privacy" TEXT NOT NULL DEFAULT 'closed',
    "parentTeamId" TEXT,
    "parentTeamSlug" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "membersCount" INTEGER,
    "reposCount" INTEGER,
    "syncState" "GitHubTeamSyncState" NOT NULL DEFAULT 'SYNCED',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTeam" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "githubTeamId" TEXT NOT NULL,
    "role" "ProjectTeamRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTeam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitHubTeam_installationId_idx" ON "GitHubTeam"("installationId");

-- CreateIndex
CREATE INDEX "GitHubTeam_orgLogin_idx" ON "GitHubTeam"("orgLogin");

-- CreateIndex
CREATE INDEX "GitHubTeam_slug_idx" ON "GitHubTeam"("slug");

-- CreateIndex
CREATE INDEX "GitHubTeam_syncState_idx" ON "GitHubTeam"("syncState");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubTeam_installationId_githubTeamId_key" ON "GitHubTeam"("installationId", "githubTeamId");

-- CreateIndex
CREATE INDEX "ProjectTeam_projectId_idx" ON "ProjectTeam"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTeam_githubTeamId_idx" ON "ProjectTeam"("githubTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTeam_projectId_githubTeamId_key" ON "ProjectTeam"("projectId", "githubTeamId");

-- AddForeignKey
ALTER TABLE "GitHubTeam" ADD CONSTRAINT "GitHubTeam_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_githubTeamId_fkey" FOREIGN KEY ("githubTeamId") REFERENCES "GitHubTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
