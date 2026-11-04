// apps/web/src/types/api.ts

// ============================================================
// ENUMS (miroir du backend Prisma)
// ============================================================

export type Role =
  | "PLATFORM_ADMIN"
  | "PLATFORM_USER"
  // Valeurs historiques conservées pour les anciens comptes/jetons.
  | "ADMIN"
  | "DEVELOPER";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING" | "DISABLED";
export type ProjectRole =
  | "OWNER"
  | "MAINTAINER"
  | "DEVELOPER"
  | "SECURITY_ANALYST"
  | "REPORTER"
  | "GUEST";
export type ProjectMemberStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
export type PermissionScopeType = "GLOBAL" | "PROJECT";
export type SpecialPermission =
  | "APPROVE_PRODUCTION"
  | "MANAGE_SECURITY_POLICY"
  | "MANAGE_SERVERS"
  | "MANAGE_INTEGRATIONS"
  | "MANAGE_PROJECT_MEMBERS"
  | "MANAGE_GITHUB_TEAMS"
  | "ACCEPT_SECURITY_RISK"
  | "MANAGE_DEPLOYMENTS"
  | "MANAGE_PROJECT_SECRETS"
  | "VIEW_SECURITY_AUDIT";
export type GitProvider = "GITHUB" | "GITLAB";
export type Technology = "NODEJS" | "PHP" | "PYTHON" | "UNKNOWN";
export type PipelineStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "SUCCESS_WITH_WARNINGS"
  | "FAILED"
  | "SECURITY_BLOCKED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "WAITING_APPROVAL";
export type StepStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "SUCCESS_WITH_WARNINGS"
  | "FAILED"
  | "SECURITY_BLOCKED"
  | "CANCELLED"
  | "SKIPPED"
  | "TIMED_OUT"
  | "WAITING_APPROVAL";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type ScanType = "SECRET" | "SAST" | "SCA" | "IMAGE" | "IAC" | "DAST";
export type ScanOutcome =
  | "SUCCESS_NO_FINDINGS"
  | "SUCCESS_WITH_FINDINGS"
  | "INTERRUPTED"
  | "SCANNER_UNAVAILABLE"
  | "PARSE_ERROR"
  | "NOT_APPLICABLE"
  | "DISABLED"
  | "REQUIRED_NOT_RUN";
export type SecurityGateStatus = "PASSED" | "WARNING" | "FAILED" | "BLOCKED";
export type SecurityGateMode = "WARNING" | "ENFORCEMENT";
export type SecurityGateCategory =
  | "SECRET"
  | "SAST"
  | "SCA"
  | "IMAGE"
  | "IAC"
  | "DAST";
export type SecurityGateExceptionStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED";
export type SecurityGateExceptionMatchType =
  | "ANY"
  | "FINGERPRINT"
  | "CVE"
  | "RULE"
  | "REFERENCE";
export type VulnerabilityStatus =
  | "OPEN"
  | "CONFIRMED"
  | "FIXED"
  | "FALSE_POSITIVE"
  | "RISK_ACCEPTED"
  | "DUPLICATE";
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
  username?: string | null;
  name: string;
  role: Role;
  status?: UserStatus;
  isActive?: boolean;
  lastLoginAt?: string | null;
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
  status?: UserStatus;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  globalPermissions?: string[];
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
  currentUserRole?: ProjectRole;
  isPlatformAdmin?: boolean;
  permissions?: string[];
  _count?: { pipelines: number; deployments: number; members?: number };
}

export interface ProjectMember {
  id: string;
  projectId?: string;
  userId: string;
  role: ProjectRole;
  status: ProjectMemberStatus;
  createdAt: string;
  updatedAt: string;
  user: Pick<User, "id" | "email" | "name" | "username" | "status" | "lastLoginAt">;
  invitedBy?: Pick<User, "id" | "name" | "email"> | null;
  specialPermissions?: Array<{
    id: string;
    permission: SpecialPermission;
    expiresAt: string | null;
    createdAt: string;
  }>;
}

export interface ProjectInvitation {
  id: string;
  email: string;
  role: ProjectRole;
  expiresAt: string;
  createdAt: string;
  invitedBy?: Pick<User, "id" | "name" | "email"> | null;
}

export interface PermissionGrant {
  id: string;
  permission: SpecialPermission;
  scopeType: PermissionScopeType;
  scopeId?: string | null;
  expiresAt: string | null;
  createdAt: string;
  user: Pick<User, "id" | "email" | "name" | "username" | "status" | "lastLoginAt">;
  grantedBy?: Pick<User, "id" | "name" | "email"> | null;
}

export interface AuthorizationCatalog {
  globalRoles: Array<{ role: Role; label: string; permissions: string[] }>;
  projectRoles: Array<{
    role: ProjectRole;
    label: string;
    permissions: string[];
  }>;
  permissions: string[];
  specialPermissions: Array<{
    permission: SpecialPermission;
    label: string;
    description: string;
    scope: "GLOBAL" | "PROJECT" | "BOTH";
    capabilities: string[];
  }>;
}

export interface ProjectConfiguration {
  id: string;
  projectId: string;
  triggerBranches: string[];
  gitleaksEnabled: boolean;
  semgrepEnabled: boolean;
  scaEnabled: boolean;
  iacEnabled: boolean;
  trivyEnabled: boolean;
  syftEnabled: boolean;
  zapEnabled: boolean;
  cosignEnabled: boolean;
  securityGateCritical: number;
  securityGateHigh: number;
  securityGateMedium: number;
  securityGateLow: number;
  gateMode: SecurityGateMode;
  gateEnforcementAt: string | null;
  gateSecretsEnabled: boolean;
  gateSastEnabled: boolean;
  gateScaEnabled: boolean;
  gateIacEnabled: boolean;
  gateImageEnabled: boolean;
  gateDastEnabled: boolean;
  deploymentStrategy: "direct" | "staging_then_production";
  stagingPort: number | null;
  productionPort: number | null;
  autoRollback: boolean;
  requireProductionApproval: boolean;
  mandatoryControls: SecurityGateCategory[];
  requireExceptionApproval: boolean;
  ansibleLintEnabled: boolean;
  ansibleSyntaxCheckEnabled: boolean;
  ansibleTimeoutMs: number;
  ansibleMaxPlaybooks: number;
  postDeployChecksEnabled: boolean;
  healthcheckPath: string;
  healthcheckTimeoutMs: number;
  rescanEnabled: boolean;
  rescanIntervalHours: number;
  rescanControls: string[];
  rescanTimeoutMs: number;
  rescanMaxRunsPerDay: number;
  rescanNextRunAt: string | null;
  rescanLastRunAt: string | null;
  rescanRemediationEnabled: boolean;
  policyVersion: number;
  policyUpdatedAt: string;
  policyUpdatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityGateThresholds {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface SecurityGateCategoryPolicy {
  enabled: boolean;
  scannerEnabled: boolean;
  mandatory: boolean;
}

export interface SecurityPolicySnapshot {
  schemaVersion: number;
  version: number;
  mode: SecurityGateMode;
  enforcementAt: string | null;
  thresholds: SecurityGateThresholds;
  categories: Record<SecurityGateCategory, SecurityGateCategoryPolicy>;
  requireExceptionApproval: boolean;
}

export interface SecurityGateExceptionEvent {
  id: string;
  exceptionId: string;
  actorId: string | null;
  action: string;
  fromStatus: SecurityGateExceptionStatus | null;
  toStatus: SecurityGateExceptionStatus | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
}

export interface SecurityGateException {
  id: string;
  projectId: string;
  category: "ALL" | SecurityGateCategory;
  severity: Severity | null;
  fingerprint: string | null;
  matchType: SecurityGateExceptionMatchType;
  reason: string;
  status: SecurityGateExceptionStatus;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string; email: string } | null;
  approvedBy?: { id: string; name: string; email: string } | null;
  events?: SecurityGateExceptionEvent[];
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
    members?: number;
  };
  currentUserRole?: ProjectRole;
  isPlatformAdmin?: boolean;
  permissions?: string[];
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
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  baseBranch: string | null;
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
  /** Dans les listes : première étape non réussie (pour l'action Reprendre). */
  steps?: Array<Pick<PipelineStep, "id" | "name" | "order" | "status">>;
  /** Présent dans la liste globale des pipelines. */
  project?: {
    id: string;
    name: string;
    repoFullName?: string;
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

export interface SecurityGateControl {
  category: SecurityGateCategory;
  required: boolean;
  mandatory: boolean;
  scannerEnabled: boolean;
  state: ScanOutcome;
  reason: string | null;
}

export interface SecurityGateFailure {
  category: string;
  step: string;
  state: ScanOutcome;
  reason: string;
  mandatory?: boolean;
}

export interface SecurityGateResult {
  id: string;
  pipelineId: string;
  status: SecurityGateStatus;
  mode: SecurityGateMode;
  rulesJson: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    mode?: SecurityGateMode;
    categories?: Record<string, boolean>;
    policyVersion?: number;
    policyHash?: string;
    gateKey?: string;
    thresholds?: SecurityGateThresholds;
    controls?: SecurityGateControl[];
    rawCounts?: Record<string, number>;
  };
  critical: number;
  high: number;
  medium: number;
  low: number;
  blocked: boolean;
  reason: string | null;
  technicalFailures: SecurityGateFailure[] | null;
  /** Les anciennes décisions peuvent contenir un objet { applied, ignored }. */
  exceptionsApplied:
    | SecurityGateExceptionApplication[]
    | {
        applied?: SecurityGateExceptionApplication[];
        ignored?: unknown[];
      }
    | null;
  createdAt: string;
}

export interface SecurityGateExceptionApplication {
  id: string;
  category: string;
  severity: string | null;
  fingerprint: string | null;
  matchType?: string;
  reason: string;
  expiresAt: string | null;
}

export interface PipelineGateEvaluation {
  id: string;
  pipelineId: string;
  policySnapshotId: string | null;
  gateKey: "PRE_DEPLOY" | "POST_DAST" | string;
  status: SecurityGateStatus;
  mode: SecurityGateMode;
  blocked: boolean;
  thresholdsJson: SecurityGateThresholds;
  controlsJson: SecurityGateControl[] | Record<string, unknown>;
  exceptionsJson: Record<string, unknown> | null;
  technicalFailures: SecurityGateFailure[] | null;
  countsJson: {
    retained?: Record<string, number>;
    raw?: Record<string, number>;
  };
  reason: string | null;
  evaluatedAt: string;
}

export interface PipelineSecurityPolicy {
  id: string;
  pipelineId: string;
  projectId: string;
  version: number;
  policyHash: string;
  policyJson: SecurityPolicySnapshot;
  createdAt: string;
}

export interface DockerImage {
  id: string;
  pipelineId: string;
  imageTag: string;
  imageId: string | null;
  /** Digest immuable de l'artefact promu (sha256:...). */
  imageDigest: string | null;
  digestAlgorithm: string;
  digestVerifiedAt: string | null;
  sizeBytes: string | null; // BigInt sérialisé en string par le backend
  registry: string | null;
  signed: boolean;
  signatureRef: string | null;
  createdAt: string;
}

export type DeploymentApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED";

export interface DeploymentApproval {
  id: string;
  pipelineId: string;
  projectId: string;
  deploymentId: string | null;
  environment: string;
  commitSha: string;
  imageTag: string;
  imageDigest: string;
  status: DeploymentApprovalStatus;
  requestedAt: string;
  decidedById: string | null;
  decidedAt: string | null;
  comment: string | null;
  expiresAt: string | null;
  createdAt: string;
  project?: { id: string; name: string; ownerId?: string };
  pipeline?: {
    id: string;
    commitSha: string;
    branch: string;
    status: PipelineStatus;
    pullRequestNumber?: number | null;
  };
  decidedBy?: { id: string; name: string; email: string } | null;
  requestedBy?: { id: string; name: string; email: string } | null;
}

export interface Deployment {
  id: string;
  pipelineId: string;
  projectId: string;
  serverId: string;
  status: DeploymentStatus;
  environment: string;
  imageTag: string | null;
  imageDigest: string | null;
  releaseVersion: string | null;
  url: string | null;
  stagingUrl: string | null;
  stagingStatus: DeploymentStatus | null;
  productionUrl: string | null;
  productionStatus: DeploymentStatus | null;
  rollbackImageTag: string | null;
  rollbackImageDigest: string | null;
  previousDeploymentId: string | null;
  approval?: DeploymentApproval | null;
  verifications?: DeploymentVerification[];
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export type DeploymentCheckStatus = "PASSED" | "FAILED" | "SKIPPED";
export type DeploymentVerificationStatus = "PASSED" | "FAILED" | "SKIPPED";

export interface DeploymentCheck {
  key: string;
  label: string;
  status: DeploymentCheckStatus;
  required: boolean;
  detail: string;
  expected?: string;
  observed?: string;
}

export interface DeploymentVerification {
  id: string;
  projectId?: string;
  deploymentId: string;
  pipelineId: string;
  environment: string;
  status: DeploymentVerificationStatus;
  imageTag: string | null;
  imageDigest: string | null;
  checksJson: DeploymentCheck[];
  summaryJson: {
    passed: number;
    failed: number;
    skipped: number;
    required: number;
  } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  deployment?: Deployment;
  pipeline?: {
    id: string;
    commitSha: string;
    branch: string;
    status: PipelineStatus;
  };
}

// ============================================================
// RESCAN PÉRIODIQUE
// ============================================================

export type RescanStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED";

export interface RescanFinding {
  fingerprint: string;
  severity: Severity;
  tool: string;
  packageName: string | null;
  filePath?: string | null;
  reference: string | null;
  description: string | null;
  status?: string | null;
}

export interface RescanComparison {
  baselineAvailable: boolean;
  baselineFingerprints: number;
  currentFingerprints: number;
  newFindings: RescanFinding[];
  resolvedFindings: RescanFinding[];
  severityChanges: Array<{
    fingerprint: string;
    tool: string;
    packageName: string | null;
    reference: string | null;
    filePath: string | null;
    previousSeverity: Severity;
    currentSeverity: Severity;
    direction: "INCREASED" | "DECREASED";
  }>;
  counts: {
    new: number;
    resolved: number;
    severityIncreased: number;
    severityDecreased: number;
    newBySeverity: Record<Severity, number>;
    increasedToHighOrCritical: number;
  };
  riskFound: boolean;
}

export interface RescanSummary {
  scanId: string;
  scanner: string;
  scannerVersion: string | null;
  vulnerabilityCount: number;
  severityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  controls: string[];
  baseline: {
    source: string | null;
    scanIds: string[];
    available: boolean;
    findings: number;
  };
  currentFindings: number;
  riskFound: boolean;
  evolution: RescanComparison["counts"];
}

export interface RescanScan {
  id: string;
  scanner: string;
  scannerVersion?: string | null;
  type?: ScanType;
  status: StepStatus;
  outcome?: ScanOutcome | null;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  durationMs?: number | null;
  exitCode?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface RescanRun {
  id: string;
  projectId: string;
  deploymentId: string;
  pipelineId: string | null;
  environment: string;
  commitSha: string;
  branch: string;
  imageTag: string | null;
  imageDigest: string;
  trigger: "SCHEDULED" | "MANUAL";
  status: RescanStatus;
  controls: string[];
  timeoutMs: number;
  scannerVersion?: string | null;
  summaryJson: RescanSummary | null;
  comparisonJson: RescanComparison | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  scans: RescanScan[];
}

export interface RescanDetail extends RescanRun {
  server?: {
    id: string;
    name: string;
    host: string;
  };
  deployment?: {
    id: string;
    environment: string;
    imageTag: string | null;
    imageDigest: string | null;
    finishedAt: string | null;
  };
  pipeline?: {
    id: string;
    commitSha: string;
    branch: string;
    status: PipelineStatus;
    createdAt: string;
  } | null;
}

export interface SbomSummary {
  packageCount: number;
  packages: Array<{
    name: string;
    version: string | null;
    type: string | null;
    language: string | null;
    purl: string | null;
    license: string | null;
  }>;
  source: Record<string, unknown> | null;
  descriptor: Record<string, unknown> | null;
}

export interface Sbom {
  id: string;
  pipelineId: string;
  projectId: string;
  format: string;
  packageCount: number;
  contentJson: SbomSummary;
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
  gateEvaluations?: PipelineGateEvaluation[];
  securityPolicy?: PipelineSecurityPolicy | null;
  dockerImage: DockerImage | null;
  deployment: Deployment | null;
  approval?: DeploymentApproval | null;
  sbom: Sbom | null;
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
  scannerVersion?: string | null;
  type: ScanType;
  status: StepStatus;
  outcome: ScanOutcome | null;
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
  fingerprint: string | null;
  tool: string;
  technology: string | null;
  severity: Severity;
  packageName: string | null;
  filePath: string | null;
  version: string | null;
  fixedVersion: string | null;
  description: string | null;
  reference: string | null;
  status: VulnerabilityStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  detectedAt: string;
  occurrences: number;
  assignedTo: { id: string; name: string; email: string } | null;
  notes: string | null;
  dueDate: string | null;
  scan: {
    id: string;
    scanner: string;
    type: ScanType;
    pipelineId: string;
    createdAt?: string;
    pipeline?: {
      commitSha: string;
      branch: string;
      status: PipelineStatus;
    } | null;
  } | null;
  scans: Array<{
    id: string;
    scanner: string;
    type: ScanType;
    pipelineId: string;
    createdAt: string;
    pipeline?: {
      commitSha: string;
      branch: string;
      status: PipelineStatus;
    } | null;
  }>;
}

export interface VulnerabilitySummary {
  severityCounts: Record<Severity, number>;
  statusCounts: Record<VulnerabilityStatus, number>;
  toolCounts: Record<string, number>;
  scanTypeCounts: Record<string, number>;
  uniqueCount: number;
  openCount: number;
  occurrenceCount: number;
  topFindings: Vulnerability[];
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
  /** Référence de confiance de la clé d'hôte (SHA256:<base64 sans padding>). */
  hostKeyFingerprint: string | null;
  hostKeyAlgorithm: string | null;
  hostKeyTrustedAt: string | null;
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
    mode?: SecurityGateMode;
    blocked: boolean;
    reason: string | null;
    rules: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      policyVersion?: number;
      policyHash?: string;
    };
  } | null;
  securityPolicy?: {
    version: number;
    policyHash: string;
    mode: SecurityGateMode;
    enforcementAt: string | null;
  } | null;
  gates?: Array<{
    gateKey: string;
    status: SecurityGateStatus;
    mode: SecurityGateMode;
    blocked: boolean;
    reason: string | null;
  }>;
  dockerImage: {
    imageTag: string;
    imageId: string | null;
    signed?: boolean;
  } | null;
  sbom?: {
    packageCount: number;
    format: string;
  } | null;
  deployment: {
    status: DeploymentStatus;
    environment?: string;
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