-- AlterTable
ALTER TABLE "ProjectConfiguration" ADD COLUMN     "defectDojoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defectDojoEngagementId" INTEGER,
ADD COLUMN     "defectDojoProductId" INTEGER;

-- AlterTable
ALTER TABLE "SystemConfig" ADD COLUMN     "defectDojoApiTokenEncrypted" TEXT,
ADD COLUMN     "defectDojoConfigured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defectDojoUrl" TEXT;

-- CreateTable
CREATE TABLE "DefectDojoImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pipelineId" TEXT,
    "engagementId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectDojoImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectDojoImport_projectId_idx" ON "DefectDojoImport"("projectId");

-- CreateIndex
CREATE INDEX "DefectDojoImport_pipelineId_idx" ON "DefectDojoImport"("pipelineId");

-- CreateIndex
CREATE INDEX "DefectDojoImport_createdAt_idx" ON "DefectDojoImport"("createdAt");
