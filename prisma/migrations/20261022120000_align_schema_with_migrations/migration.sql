-- CreateEnum
CREATE TYPE "SecurityGateMode" AS ENUM ('WARNING', 'ENFORCEMENT');

-- CreateEnum
CREATE TYPE "VulnerabilityStatus" AS ENUM ('OPEN', 'CONFIRMED', 'FIXED', 'FALSE_POSITIVE', 'RISK_ACCEPTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SUCCESS', 'WARNING', 'DANGER', 'INFO');

-- AlterEnum
ALTER TYPE "ScanType" ADD VALUE 'IAC';

-- AlterEnum
ALTER TYPE "SecurityGateStatus" ADD VALUE 'WARNING';

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN     "productionStatus" "DeploymentStatus",
ADD COLUMN     "productionUrl" TEXT,
ADD COLUMN     "rollbackImageTag" TEXT,
ADD COLUMN     "stagingStatus" "DeploymentStatus",
ADD COLUMN     "stagingUrl" TEXT;

-- AlterTable
ALTER TABLE "DockerImage" ADD COLUMN     "signatureRef" TEXT,
ADD COLUMN     "signed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "baseBranch" TEXT,
ADD COLUMN     "pullRequestNumber" INTEGER,
ADD COLUMN     "pullRequestUrl" TEXT;

-- AlterTable
ALTER TABLE "ProjectConfiguration" ADD COLUMN     "autoRollback" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cosignEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deploymentStrategy" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN     "gateDastEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gateEnforcementAt" TIMESTAMP(3),
ADD COLUMN     "gateIacEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gateImageEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gateMode" "SecurityGateMode" NOT NULL DEFAULT 'WARNING',
ADD COLUMN     "gateSastEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gateScaEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gateSecretsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "iacEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "productionPort" INTEGER,
ADD COLUMN     "stagingPort" INTEGER,
ADD COLUMN     "syftEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SecurityGateResult" ADD COLUMN     "exceptionsApplied" JSONB,
ADD COLUMN     "mode" "SecurityGateMode" NOT NULL DEFAULT 'WARNING',
ADD COLUMN     "technicalFailures" JSONB;

-- AlterTable
ALTER TABLE "Vulnerability" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "occurrences" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" "VulnerabilityStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Sbom" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'syft-json',
    "packageCount" INTEGER NOT NULL DEFAULT 0,
    "contentJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sbom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityGateException" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ALL',
    "severity" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityGateException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sbom_pipelineId_key" ON "Sbom"("pipelineId");

-- CreateIndex
CREATE INDEX "Sbom_projectId_idx" ON "Sbom"("projectId");

-- CreateIndex
CREATE INDEX "SecurityGateException_projectId_idx" ON "SecurityGateException"("projectId");

-- CreateIndex
CREATE INDEX "SecurityGateException_expiresAt_idx" ON "SecurityGateException"("expiresAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_deletedAt_idx" ON "Notification"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_sourceKey_key" ON "Notification"("userId", "sourceKey");

-- CreateIndex
CREATE INDEX "Vulnerability_fingerprint_idx" ON "Vulnerability"("fingerprint");

-- CreateIndex
CREATE INDEX "Vulnerability_status_idx" ON "Vulnerability"("status");

-- CreateIndex
CREATE INDEX "Vulnerability_assignedToId_idx" ON "Vulnerability"("assignedToId");

-- AddForeignKey
ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sbom" ADD CONSTRAINT "Sbom_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sbom" ADD CONSTRAINT "Sbom_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityGateException" ADD CONSTRAINT "SecurityGateException_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityGateException" ADD CONSTRAINT "SecurityGateException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

