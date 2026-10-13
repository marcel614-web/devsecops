-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "GitProvider" AS ENUM ('GITHUB', 'GITLAB');

-- CreateEnum
CREATE TYPE "Technology" AS ENUM ('NODEJS', 'PHP', 'PYTHON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'SECURITY_BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'SECURITY_BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('SECRET', 'SAST', 'SCA', 'IMAGE', 'DAST');

-- CreateEnum
CREATE TYPE "SecurityGateStatus" AS ENUM ('PASSED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServerAuthType" AS ENUM ('SSH_KEY', 'PASSWORD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DEVELOPER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "scopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "provider" "GitProvider" NOT NULL DEFAULT 'GITHUB',
    "repoFullName" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "technology" "Technology" NOT NULL DEFAULT 'UNKNOWN',
    "deploymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "serverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectConfiguration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "triggerBranches" TEXT[],
    "gitleaksEnabled" BOOLEAN NOT NULL DEFAULT true,
    "semgrepEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "trivyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "zapEnabled" BOOLEAN NOT NULL DEFAULT true,
    "securityGateCritical" INTEGER NOT NULL DEFAULT 0,
    "securityGateHigh" INTEGER NOT NULL DEFAULT 2,
    "securityGateMedium" INTEGER NOT NULL DEFAULT 10,
    "securityGateLow" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'push',
    "status" "PipelineStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "exitCode" INTEGER,
    "resultJson" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineLog" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stepId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityScan" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scanner" TEXT NOT NULL,
    "type" "ScanType" NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'QUEUED',
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "mediumCount" INTEGER NOT NULL DEFAULT 0,
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "infoCount" INTEGER NOT NULL DEFAULT 0,
    "rawResultJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "exitCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vulnerability" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "technology" TEXT,
    "severity" "Severity" NOT NULL,
    "packageName" TEXT,
    "filePath" TEXT,
    "version" TEXT,
    "fixedVersion" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vulnerability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityGateResult" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "status" "SecurityGateStatus" NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "critical" INTEGER NOT NULL DEFAULT 0,
    "high" INTEGER NOT NULL DEFAULT 0,
    "medium" INTEGER NOT NULL DEFAULT 0,
    "low" INTEGER NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityGateResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DockerImage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "imageTag" TEXT NOT NULL,
    "imageId" TEXT,
    "sizeBytes" BIGINT,
    "registry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DockerImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentServer" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL DEFAULT 'deploy',
    "authType" "ServerAuthType" NOT NULL DEFAULT 'SSH_KEY',
    "encryptedPrivateKey" TEXT,
    "encryptedPassphrase" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "imageTag" TEXT,
    "releaseVersion" TEXT,
    "url" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityReport" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "htmlPath" TEXT,
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadataJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubConnection_userId_key" ON "GitHubConnection"("userId");

-- CreateIndex
CREATE INDEX "GitHubConnection_githubUserId_idx" ON "GitHubConnection"("githubUserId");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "Project_repoFullName_idx" ON "Project"("repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_repoFullName_key" ON "Project"("ownerId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectConfiguration_projectId_key" ON "ProjectConfiguration"("projectId");

-- CreateIndex
CREATE INDEX "Pipeline_projectId_idx" ON "Pipeline"("projectId");

-- CreateIndex
CREATE INDEX "Pipeline_status_idx" ON "Pipeline"("status");

-- CreateIndex
CREATE INDEX "Pipeline_commitSha_idx" ON "Pipeline"("commitSha");

-- CreateIndex
CREATE INDEX "Pipeline_createdAt_idx" ON "Pipeline"("createdAt");

-- CreateIndex
CREATE INDEX "PipelineStep_pipelineId_idx" ON "PipelineStep"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineStep_status_idx" ON "PipelineStep"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_pipelineId_order_key" ON "PipelineStep"("pipelineId", "order");

-- CreateIndex
CREATE INDEX "PipelineLog_pipelineId_idx" ON "PipelineLog"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineLog_stepId_idx" ON "PipelineLog"("stepId");

-- CreateIndex
CREATE INDEX "PipelineLog_createdAt_idx" ON "PipelineLog"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityScan_pipelineId_idx" ON "SecurityScan"("pipelineId");

-- CreateIndex
CREATE INDEX "SecurityScan_projectId_idx" ON "SecurityScan"("projectId");

-- CreateIndex
CREATE INDEX "SecurityScan_scanner_idx" ON "SecurityScan"("scanner");

-- CreateIndex
CREATE INDEX "Vulnerability_scanId_idx" ON "Vulnerability"("scanId");

-- CreateIndex
CREATE INDEX "Vulnerability_severity_idx" ON "Vulnerability"("severity");

-- CreateIndex
CREATE INDEX "Vulnerability_tool_idx" ON "Vulnerability"("tool");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityGateResult_pipelineId_key" ON "SecurityGateResult"("pipelineId");

-- CreateIndex
CREATE INDEX "SecurityGateResult_status_idx" ON "SecurityGateResult"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DockerImage_pipelineId_key" ON "DockerImage"("pipelineId");

-- CreateIndex
CREATE INDEX "DeploymentServer_ownerId_idx" ON "DeploymentServer"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentServer_ownerId_name_key" ON "DeploymentServer"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_pipelineId_key" ON "Deployment"("pipelineId");

-- CreateIndex
CREATE INDEX "Deployment_projectId_idx" ON "Deployment"("projectId");

-- CreateIndex
CREATE INDEX "Deployment_serverId_idx" ON "Deployment"("serverId");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityReport_pipelineId_key" ON "SecurityReport"("pipelineId");

-- CreateIndex
CREATE INDEX "SecurityReport_projectId_idx" ON "SecurityReport"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "GitHubConnection" ADD CONSTRAINT "GitHubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "DeploymentServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConfiguration" ADD CONSTRAINT "ProjectConfiguration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineLog" ADD CONSTRAINT "PipelineLog_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineLog" ADD CONSTRAINT "PipelineLog_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityScan" ADD CONSTRAINT "SecurityScan_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityScan" ADD CONSTRAINT "SecurityScan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "SecurityScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityGateResult" ADD CONSTRAINT "SecurityGateResult_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DockerImage" ADD CONSTRAINT "DockerImage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentServer" ADD CONSTRAINT "DeploymentServer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "DeploymentServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReport" ADD CONSTRAINT "SecurityReport_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReport" ADD CONSTRAINT "SecurityReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
