-- CreateEnum
CREATE TYPE "DeploymentApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "imageDigest" TEXT,
ADD COLUMN     "previousDeploymentId" TEXT,
ADD COLUMN     "rollbackImageDigest" TEXT;

-- AlterTable
ALTER TABLE "DeploymentServer" ADD COLUMN     "hostKeyAlgorithm" TEXT,
ADD COLUMN     "hostKeyFingerprint" TEXT,
ADD COLUMN     "hostKeyTrustedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DockerImage" ADD COLUMN     "digestAlgorithm" TEXT NOT NULL DEFAULT 'sha256',
ADD COLUMN     "digestVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "imageDigest" TEXT;

-- AlterTable
ALTER TABLE "ProjectConfiguration" ADD COLUMN     "requireProductionApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SecurityGateException" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "DeploymentLock" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentApproval" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deploymentId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "commitSha" TEXT NOT NULL,
    "imageTag" TEXT NOT NULL,
    "imageDigest" TEXT NOT NULL,
    "status" "DeploymentApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentLock_projectId_key" ON "DeploymentLock"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentLock_pipelineId_key" ON "DeploymentLock"("pipelineId");

-- CreateIndex
CREATE INDEX "DeploymentLock_expiresAt_idx" ON "DeploymentLock"("expiresAt");

-- CreateIndex
CREATE INDEX "DeploymentLock_pipelineId_idx" ON "DeploymentLock"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentApproval_pipelineId_key" ON "DeploymentApproval"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentApproval_deploymentId_key" ON "DeploymentApproval"("deploymentId");

-- CreateIndex
CREATE INDEX "DeploymentApproval_projectId_status_idx" ON "DeploymentApproval"("projectId", "status");

-- CreateIndex
CREATE INDEX "DeploymentApproval_status_idx" ON "DeploymentApproval"("status");

-- CreateIndex
CREATE INDEX "DeploymentApproval_expiresAt_idx" ON "DeploymentApproval"("expiresAt");

-- CreateIndex
CREATE INDEX "Deployment_imageDigest_idx" ON "Deployment"("imageDigest");

-- CreateIndex
CREATE INDEX "DockerImage_imageDigest_idx" ON "DockerImage"("imageDigest");

-- AddForeignKey
ALTER TABLE "DeploymentLock" ADD CONSTRAINT "DeploymentLock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentLock" ADD CONSTRAINT "DeploymentLock_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentApproval" ADD CONSTRAINT "DeploymentApproval_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentApproval" ADD CONSTRAINT "DeploymentApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentApproval" ADD CONSTRAINT "DeploymentApproval_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentApproval" ADD CONSTRAINT "DeploymentApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentApproval" ADD CONSTRAINT "DeploymentApproval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
