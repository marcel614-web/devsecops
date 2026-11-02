-- AlterTable
ALTER TABLE "SystemConfig" ADD COLUMN     "dependencyTrackApiKeyEncrypted" TEXT,
ADD COLUMN     "dependencyTrackConfigured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dependencyTrackUrl" TEXT;
