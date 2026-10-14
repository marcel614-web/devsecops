/*
  Warnings:

  - You are about to drop the `GitHubConnection` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GitHubConnection" DROP CONSTRAINT "GitHubConnection_userId_fkey";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "githubRepositoryId" TEXT,
ADD COLUMN     "monitoredBranch" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "errorMessage" TEXT;

-- DropTable
DROP TABLE "GitHubConnection";

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubRepository" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "language" TEXT,
    "description" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubRepository_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_userId_idx" ON "GitHubInstallation"("userId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_accountLogin_idx" ON "GitHubInstallation"("accountLogin");

-- CreateIndex
CREATE INDEX "GitHubInstallation_revokedAt_idx" ON "GitHubInstallation"("revokedAt");

-- CreateIndex
CREATE INDEX "GitHubRepository_installationId_idx" ON "GitHubRepository"("installationId");

-- CreateIndex
CREATE INDEX "GitHubRepository_fullName_idx" ON "GitHubRepository"("fullName");

-- CreateIndex
CREATE INDEX "GitHubRepository_repositoryId_idx" ON "GitHubRepository"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubRepository_installationId_repositoryId_key" ON "GitHubRepository"("installationId", "repositoryId");

-- CreateIndex
CREATE INDEX "Project_githubRepositoryId_idx" ON "Project"("githubRepositoryId");

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubRepository" ADD CONSTRAINT "GitHubRepository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_githubRepositoryId_fkey" FOREIGN KEY ("githubRepositoryId") REFERENCES "GitHubRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
