-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "githubConfigured" BOOLEAN NOT NULL DEFAULT false,
    "githubAppId" TEXT,
    "githubAppSlug" TEXT,
    "githubPrivateKeyEncrypted" TEXT,
    "githubWebhookSecretEncrypted" TEXT,
    "githubClientId" TEXT,
    "githubClientSecretEncrypted" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "SystemConfig_key_idx" ON "SystemConfig"("key");
