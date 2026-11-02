-- CreateEnum
CREATE TYPE "RescanStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeploymentVerificationStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "ProjectConfiguration" ADD COLUMN     "ansibleLintEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ansibleMaxPlaybooks" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "ansibleSyntaxCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ansibleTimeoutMs" INTEGER NOT NULL DEFAULT 300000,
ADD COLUMN     "healthcheckPath" TEXT NOT NULL DEFAULT '/',
ADD COLUMN     "healthcheckTimeoutMs" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "postDeployChecksEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rescanControls" TEXT[] DEFAULT ARRAY['IMAGE']::TEXT[],
ADD COLUMN     "rescanEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rescanIntervalHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "rescanLastRunAt" TIMESTAMP(3),
ADD COLUMN     "rescanMaxRunsPerDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rescanNextRunAt" TIMESTAMP(3),
ADD COLUMN     "rescanRemediationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rescanTimeoutMs" INTEGER NOT NULL DEFAULT 1200000;

-- AlterTable
ALTER TABLE "SecurityScan" ADD COLUMN     "rescanRunId" TEXT,
ADD COLUMN     "scannerVersion" TEXT,
ALTER COLUMN "pipelineId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DeploymentVerification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" "DeploymentVerificationStatus" NOT NULL DEFAULT 'FAILED',
    "imageTag" TEXT,
    "imageDigest" TEXT,
    "checksJson" JSONB NOT NULL,
    "summaryJson" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RescanRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "pipelineId" TEXT,
    "serverId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "imageTag" TEXT,
    "imageDigest" TEXT NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "status" "RescanStatus" NOT NULL DEFAULT 'QUEUED',
    "controls" TEXT[] DEFAULT ARRAY['IMAGE']::TEXT[],
    "timeoutMs" INTEGER NOT NULL DEFAULT 1200000,
    "scannerVersion" TEXT,
    "summaryJson" JSONB,
    "comparisonJson" JSONB,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RescanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeploymentVerification_projectId_createdAt_idx" ON "DeploymentVerification"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "DeploymentVerification_status_idx" ON "DeploymentVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentVerification_deploymentId_environment_key" ON "DeploymentVerification"("deploymentId", "environment");

-- CreateIndex
CREATE INDEX "RescanRun_projectId_createdAt_idx" ON "RescanRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RescanRun_status_idx" ON "RescanRun"("status");

-- CreateIndex
CREATE INDEX "RescanRun_imageDigest_idx" ON "RescanRun"("imageDigest");

-- CreateIndex
CREATE INDEX "RescanRun_status_startedAt_idx" ON "RescanRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RescanRun_deploymentId_cycleKey_key" ON "RescanRun"("deploymentId", "cycleKey");

-- CreateIndex
CREATE INDEX "SecurityScan_rescanRunId_idx" ON "SecurityScan"("rescanRunId");

-- AddForeignKey
ALTER TABLE "SecurityScan" ADD CONSTRAINT "SecurityScan_rescanRunId_fkey" FOREIGN KEY ("rescanRunId") REFERENCES "RescanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVerification" ADD CONSTRAINT "DeploymentVerification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVerification" ADD CONSTRAINT "DeploymentVerification_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVerification" ADD CONSTRAINT "DeploymentVerification_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescanRun" ADD CONSTRAINT "RescanRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescanRun" ADD CONSTRAINT "RescanRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescanRun" ADD CONSTRAINT "RescanRun_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescanRun" ADD CONSTRAINT "RescanRun_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "DeploymentServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
