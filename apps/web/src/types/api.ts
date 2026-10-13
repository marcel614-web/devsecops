export type Role = "ADMIN" | "DEVELOPER";
export type GitProvider = "GITHUB" | "GITLAB";
export type Technology = "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN";
export type PipelineStatus =
  | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "SECURITY_BLOCKED" | "CANCELLED";
export type StepStatus = PipelineStatus;
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type ScanType = "SECRET" | "SAST" | "SCA" | "IMAGE" | "DAST";
export type SecurityGateStatus = "PASSED" | "FAILED" | "BLOCKED";
export type ServerAuthType = "SSH_KEY" | "PASSWORD";

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

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
  _count?: { projects: number; deployments: number };
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
    critical: number; high: number; medium: number; low: number;
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
  sizeBytes: string | null;
  registry: string | null;
  createdAt: string;
}

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
  _count?: { steps: number; scans: number; logs?: number };
}

export interface PipelineDetail extends Pipeline {
  steps: PipelineStep[];
  gateResult: SecurityGateResult | null;
  dockerImage: DockerImage | null;
  deployment: unknown | null;
}

export interface PipelineLog {
  id: string;
  pipelineId: string;
  stepId: string | null;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  sequence: number;
  createdAt: string;
  step: { id: string; name: string; type: string; order: number } | null;
}

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
  _count?: { vulnerabilities: number };
}

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
  scan: { id: string; scanner: string; type: ScanType; pipelineId: string };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

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
  recentPipelines: Array<Pipeline & {
    project: { id: string; name: string; repoFullName: string };
  }>;
  topVulnerabilities: Array<Vulnerability & {
    scan: { pipelineId: string; project: { id: string; name: string } };
  }>;
}