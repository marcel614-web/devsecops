// apps/web/src/types/api.ts

// ============================================================
// ENUMS (miroir du backend Prisma)
// ============================================================

export type Role = "ADMIN" | "DEVELOPER";
export type GitProvider = "GITHUB" | "GITLAB";
export type Technology = "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN";
export type PipelineStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SECURITY_BLOCKED"
  | "CANCELLED";
export type StepStatus = PipelineStatus;
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type ScanType = "SECRET" | "SAST" | "SCA" | "IMAGE" | "DAST";
export type SecurityGateStatus = "PASSED" | "FAILED" | "BLOCKED";
export type DeploymentStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";
export type ServerAuthType = "SSH_KEY" | "PASSWORD";

// ============================================================
// PAGINATION
// ============================================================

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ============================================================
// UTILISATEUR
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive?: boolean;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================
// AUTH
// ============================================================

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

// ============================================================
// PROJET
// ============================================================

export interface Project {
  id: string;
  name: string;
  description: string | null;
  provider: GitProvider;
  repoFullName: string;
  repoId: string;
  defaultBranch: string;
  technology: Technology;
  deploymentEnabled: boolean;
  serverId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfiguration {
  id: string;
  projectId: string;
  triggerBranches: string[];
  gitleaksEnabled: boolean;
  semgrepEnabled: boolean;
  scaEnabled: boolean;
  trivyEnabled: boolean;
  zapEnabled: boolean;
  securityGateCritical: number;
  securityGateHigh: number;
  securityGateMedium: number;
  securityGateLow: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Vue détaillée d'un projet (GET /api/projects/:id).
 * Inclut la config, le propriétaire et les compteurs.
 */
export interface ProjectDetail extends Project {
  config: ProjectConfiguration | null;
  owner: {
    id: string;
    email: string;
    name: string;
  };
  _count?: {
    pipelines: number;
    deployments: number;
  };
}

// ============================================================
// PIPELINE
// ============================================================

export interface Pipeline {
  id: string;
  projectId: string;
  commitSha: string;
  branch: string;
  author: string;
  trigger: string;
  status: PipelineStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    steps: number;
    scans: number;
    logs?: number;
  };
}

export interface PipelineStep {
  id: string;
  pipelineId: string;
  name: string;
  type: string;
  order: number;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  resultJson: Record<string, unknown> | null;
  error: string | null;
}

export interface SecurityGateResult {
  id: string;
  pipelineId: string;
  status: SecurityGateStatus;
  rulesJson: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  critical: number;
  high: number;
  medium: number;
  low: number;
  blocked: boolean;
  reason: string | null;
  createdAt: string;
}

export interface DockerImage {
  id: string;
  pipelineId: string;
  imageTag: string;
  imageId: string | null;
  sizeBytes: string | null; // BigInt sérialisé en string par le backend
  registry: string | null;
  createdAt: string;
}

export interface Deployment {
  id: string;
  pipelineId: string;
  projectId: string;
  serverId: string;
  status: DeploymentStatus;
  imageTag: string | null;
  releaseVersion: string | null;
  url: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

/**
 * Vue détaillée d'un pipeline
 * (GET /api/projects/:projectId/pipelines/:id).
 * Inclut les 13 étapes, le gate, l'image Docker et le déploiement.
 */
export interface PipelineDetail extends Pipeline {
  steps: PipelineStep[];
  gateResult: SecurityGateResult | null;
  dockerImage: DockerImage | null;
  deployment: Deployment | null;
}

// ============================================================
// LOGS
// ============================================================

export interface PipelineLog {
  id: string;
  pipelineId: string;
  stepId: string | null;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  sequence: number;
  createdAt: string;
  step: {
    id: string;
    name: string;
    type: string;
    order: number;
  } | null;
}

// ============================================================
// SCANS
// ============================================================

export interface SecurityScan {
  id: string;
  scanner: string;
  type: ScanType;
  status: StepStatus;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  durationMs: number | null;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  _count?: {
    vulnerabilities: number;
  };
}

// ============================================================
// VULNÉRABILITÉS
// ============================================================

export interface Vulnerability {
  id: string;
  tool: string;
  technology: string | null;
  severity: Severity;
  packageName: string | null;
  filePath: string | null;
  version: string | null;
  fixedVersion: string | null;
  description: string | null;
  reference: string | null;
  detectedAt: string;
  scan: {
    id: string;
    scanner: string;
    type: ScanType;
    pipelineId: string;
  };
}

// ============================================================
// SERVEURS
// ============================================================

export interface DeploymentServer {
  id: string;
  ownerId: string;
  name: string;
  host: string;
  sshPort: number;
  username: string;
  authType: ServerAuthType;
  status: string;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasPrivateKey?: boolean;
  _count?: {
    projects: number;
    deployments: number;
  };
}

// ============================================================
// DASHBOARD
// ============================================================

export interface DashboardSummary {
  summary: {
    totalProjects: number;
    totalServers: number;
    totalPipelines: number;
    totalScans: number;
    totalVulnerabilities: number;
  };
  pipelinesByStatus: Record<PipelineStatus, number>;
  vulnerabilitiesBySeverity: Record<Severity, number>;
  recentPipelines: Array<
    Pipeline & {
      project: {
        id: string;
        name: string;
        repoFullName: string;
      };
    }
  >;
  topVulnerabilities: Array<
    Vulnerability & {
      scan: {
        pipelineId: string;
        project: {
          id: string;
          name: string;
        };
      };
    }
  >;
}

// ============================================================
// RAPPORT DE SÉCURITÉ
// ============================================================

/**
 * Contenu de `summaryJson` du rapport.
 * Voir le worker `final-report.step.ts` pour la structure exacte.
 */
export interface SecurityReportSummary {
  generatedAt: string;
  project: {
    id: string;
    name: string;
    repoFullName: string;
    technology: Technology;
  };
  pipeline: {
    id: string;
    commitSha: string;
    branch: string;
    author: string;
    trigger: string;
    status: PipelineStatus;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  };
  scans: Array<{
    scanner: string;
    status: StepStatus;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    durationMs: number | null;
  }>;
  totals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  gate: {
    status: SecurityGateStatus;
    blocked: boolean;
    reason: string | null;
    rules: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  } | null;
  dockerImage: {
    imageTag: string;
    imageId: string | null;
  } | null;
  deployment: {
    status: DeploymentStatus;
    url: string | null;
    releaseVersion: string | null;
  } | null;
  topFindings: Array<{
    tool: string;
    severity: Severity;
    packageName: string | null;
    filePath: string | null;
    description: string | null;
    reference: string | null;
  }>;
  vulnerabilityCount: number;
}

/**
 * Rapport de sécurité tel que renvoyé par le backend
 * (GET /api/projects/:projectId/pipelines/:id/report → { report }).
 */
export interface SecurityReport {
  id: string;
  pipelineId: string;
  projectId: string;
  summaryJson: SecurityReportSummary;
  htmlPath: string | null;
  pdfPath: string | null;
  createdAt: string;
}

// ============================================================
// AUDIT LOG
// ============================================================

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadataJson: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    name: string;
  } | null;
}

// ============================================================
// ERREURS API
// ============================================================

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}