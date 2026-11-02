/*
  Warnings:

  - Added the required column `updatedAt` to the `SecurityGateException` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScanOutcome" AS ENUM ('SUCCESS_NO_FINDINGS', 'SUCCESS_WITH_FINDINGS', 'INTERRUPTED', 'SCANNER_UNAVAILABLE', 'PARSE_ERROR', 'NOT_APPLICABLE', 'DISABLED', 'REQUIRED_NOT_RUN');

-- CreateEnum
CREATE TYPE "SecurityGateExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SecurityGateExceptionMatchType" AS ENUM ('ANY', 'FINGERPRINT', 'CVE', 'RULE', 'REFERENCE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PipelineStatus" ADD VALUE 'SUCCESS_WITH_WARNINGS';
ALTER TYPE "PipelineStatus" ADD VALUE 'TIMED_OUT';
ALTER TYPE "PipelineStatus" ADD VALUE 'WAITING_APPROVAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StepStatus" ADD VALUE 'SUCCESS_WITH_WARNINGS';
ALTER TYPE "StepStatus" ADD VALUE 'SKIPPED';
ALTER TYPE "StepStatus" ADD VALUE 'TIMED_OUT';
ALTER TYPE "StepStatus" ADD VALUE 'WAITING_APPROVAL';

-- AlterTable
ALTER TABLE "ProjectConfiguration" ADD COLUMN     "mandatoryControls" TEXT[] NOT NULL DEFAULT ARRAY['SECRET', 'SCA']::TEXT[],
ADD COLUMN     "policyUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "policyUpdatedById" TEXT,
ADD COLUMN     "policyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requireExceptionApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SecurityGateException" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "matchType" "SecurityGateExceptionMatchType" NOT NULL DEFAULT 'ANY',
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SecurityGateExceptionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Les exceptions déjà présentes avant l'introduction du workflow étaient
-- appliquées sans approbation. On les conserve approuvées pour ne pas changer
-- silencieusement une décision passée.
UPDATE "SecurityGateException"
SET "status" = 'APPROVED',
    "approvedAt" = COALESCE("approvedAt", "createdAt")
WHERE "status" = 'PENDING';

-- AlterTable
ALTER TABLE "SecurityScan" ADD COLUMN     "outcome" "ScanOutcome";

-- CreateTable
CREATE TABLE "PipelineSecurityPolicy" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "policyHash" TEXT NOT NULL,
    "policyJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineSecurityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineGateEvaluation" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "policySnapshotId" TEXT,
    "gateKey" TEXT NOT NULL,
    "status" "SecurityGateStatus" NOT NULL,
    "mode" "SecurityGateMode" NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "thresholdsJson" JSONB NOT NULL,
    "controlsJson" JSONB NOT NULL,
    "exceptionsJson" JSONB,
    "technicalFailures" JSONB,
    "countsJson" JSONB NOT NULL,
    "reason" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineGateEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityGateExceptionEvent" (
    "id" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityGateExceptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineSecurityPolicy_pipelineId_key" ON "PipelineSecurityPolicy"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineSecurityPolicy_projectId_idx" ON "PipelineSecurityPolicy"("projectId");

-- CreateIndex
CREATE INDEX "PipelineSecurityPolicy_policyHash_idx" ON "PipelineSecurityPolicy"("policyHash");

-- CreateIndex
CREATE INDEX "PipelineGateEvaluation_pipelineId_idx" ON "PipelineGateEvaluation"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineGateEvaluation_status_idx" ON "PipelineGateEvaluation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineGateEvaluation_pipelineId_gateKey_key" ON "PipelineGateEvaluation"("pipelineId", "gateKey");

-- CreateIndex
CREATE INDEX "SecurityGateExceptionEvent_exceptionId_idx" ON "SecurityGateExceptionEvent"("exceptionId");

-- CreateIndex
CREATE INDEX "SecurityGateExceptionEvent_createdAt_idx" ON "SecurityGateExceptionEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityGateException_status_idx" ON "SecurityGateException"("status");

-- AddForeignKey
ALTER TABLE "PipelineSecurityPolicy" ADD CONSTRAINT "PipelineSecurityPolicy_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineSecurityPolicy" ADD CONSTRAINT "PipelineSecurityPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineGateEvaluation" ADD CONSTRAINT "PipelineGateEvaluation_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineGateEvaluation" ADD CONSTRAINT "PipelineGateEvaluation_policySnapshotId_fkey" FOREIGN KEY ("policySnapshotId") REFERENCES "PipelineSecurityPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityGateException" ADD CONSTRAINT "SecurityGateException_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityGateExceptionEvent" ADD CONSTRAINT "SecurityGateExceptionEvent_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "SecurityGateException"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityGateExceptionEvent" ADD CONSTRAINT "SecurityGateExceptionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
