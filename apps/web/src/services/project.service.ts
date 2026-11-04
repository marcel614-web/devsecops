// apps/web/src/services/project.service.ts
import { api } from "./api";
import type {
  Paginated,
  PermissionGrant,
  Project,
  ProjectConfiguration,
  ProjectDetail,
  ProjectInvitation,
  ProjectMember,
  ProjectRole,
  SecurityGateCategory,
  SecurityGateException,
  SecurityGateExceptionMatchType,
  SecurityGateMode,
  Severity,
  SpecialPermission,
  Technology,
} from "@/types/api";
import type {
  GitHubTeam,
  ProjectTeamLink,
  ProjectTeamRole,
} from "./github.service";

// ============================================================
// TYPES
// ============================================================

export interface ListProjectsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  technology?: string;
  provider?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  provider?: "GITHUB" | "GITLAB";
  repoFullName: string;
  repoId: string;
  defaultBranch?: string;
  technology?: Technology;
  deploymentEnabled?: boolean;
  serverId?: string | null;
}

/**
 * Champs modifiables d'un projet.
 * On liste explicitement pour éviter les patches accidentels.
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  defaultBranch?: string;
  technology?: Technology;
  deploymentEnabled?: boolean;
  serverId?: string | null;
  githubRepositoryId?: string | null;
  monitoredBranch?: string | null;
}

/**
 * Champs modifiables de la configuration.
 */
export interface UpdateProjectConfigInput {
  triggerBranches?: string[];
  gitleaksEnabled?: boolean;
  semgrepEnabled?: boolean;
  scaEnabled?: boolean;
  iacEnabled?: boolean;
  trivyEnabled?: boolean;
  syftEnabled?: boolean;
  zapEnabled?: boolean;
  cosignEnabled?: boolean;
  securityGateCritical?: number;
  securityGateHigh?: number;
  securityGateMedium?: number;
  securityGateLow?: number;
  gateMode?: SecurityGateMode;
  gateEnforcementAt?: string | null;
  gateSecretsEnabled?: boolean;
  gateSastEnabled?: boolean;
  gateScaEnabled?: boolean;
  gateIacEnabled?: boolean;
  gateImageEnabled?: boolean;
  gateDastEnabled?: boolean;
  deploymentStrategy?: "direct" | "staging_then_production";
  stagingPort?: number | null;
  productionPort?: number | null;
  autoRollback?: boolean;
  requireProductionApproval?: boolean;
  mandatoryControls?: SecurityGateCategory[];
  requireExceptionApproval?: boolean;
  ansibleLintEnabled?: boolean;
  ansibleSyntaxCheckEnabled?: boolean;
  ansibleTimeoutMs?: number;
  ansibleMaxPlaybooks?: number;
  postDeployChecksEnabled?: boolean;
  healthcheckPath?: string;
  healthcheckTimeoutMs?: number;
  rescanEnabled?: boolean;
  rescanIntervalHours?: number;
  rescanControls?: Array<"IMAGE">;
  rescanTimeoutMs?: number;
  rescanMaxRunsPerDay?: number;
  rescanRemediationEnabled?: boolean;
}

export interface CreateGateExceptionInput {
  category: SecurityGateException["category"];
  severity?: Severity | null;
  /** CVE, GHSA, règle ou empreinte du finding ciblé. */
  fingerprint: string;
  matchType?: SecurityGateExceptionMatchType;
  reason: string;
  expiresAt?: string | null;
}

export interface GateExceptionDecisionInput {
  decision: "APPROVE" | "REJECT" | "REVOKE";
  comment?: string;
}

// ============================================================
// SERVICE
// ============================================================

export const projectService = {
  // ----------------------------------------------------------
  // CRUD
  // ----------------------------------------------------------
  list: (params?: ListProjectsParams) =>
    api
      .get<Paginated<Project>>("/api/projects", { params })
      .then((r) => r.data),

  get: (id: string) =>
    api
      .get<{ project: ProjectDetail }>(`/api/projects/${id}`)
      .then((r) => r.data.project),

  create: (data: CreateProjectInput) =>
    api
      .post<{ project: Project }>("/api/projects", data)
      .then((r) => r.data.project),

  update: (id: string, data: UpdateProjectInput) =>
    api
      .patch<{ project: Project }>(`/api/projects/${id}`, data)
      .then((r) => r.data.project),

  remove: (id: string) => api.delete(`/api/projects/${id}`),

  // ----------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------
  getConfig: (id: string) =>
    api
      .get<{ config: ProjectConfiguration }>(`/api/projects/${id}/config`)
      .then((r) => r.data.config),

  updateConfig: (id: string, data: UpdateProjectConfigInput) =>
    api
      .patch<{ config: ProjectConfiguration }>(
        `/api/projects/${id}/config`,
        data,
      )
      .then((r) => r.data.config),

  // ----------------------------------------------------------
  // Exceptions de Security Gate
  // ----------------------------------------------------------
  listGateExceptions: (id: string) =>
    api
      .get<{ exceptions: SecurityGateException[] }>(
        `/api/projects/${id}/gate-exceptions`,
      )
      .then((r) => r.data.exceptions),

  createGateException: (id: string, data: CreateGateExceptionInput) =>
    api
      .post<{ exception: SecurityGateException }>(
        `/api/projects/${id}/gate-exceptions`,
        data,
      )
      .then((r) => r.data.exception),

  decideGateException: (
    id: string,
    exceptionId: string,
    data: GateExceptionDecisionInput,
  ) =>
    api
      .post<{ exception: SecurityGateException }>(
        `/api/projects/${id}/gate-exceptions/${exceptionId}/decision`,
        data,
      )
      .then((r) => r.data.exception),

  /** Révocation logique : l'historique et la justification sont conservés. */
  deleteGateException: (id: string, exceptionId: string) =>
    api.delete(`/api/projects/${id}/gate-exceptions/${exceptionId}`),

  // ----------------------------------------------------------
  // Association repository GitHub
  // ----------------------------------------------------------
  associateRepository: (
    projectId: string,
    repositoryId: string,
    branch: string,
  ) =>
    api
      .post<{ project: unknown }>(`/api/projects/${projectId}/repository`, {
        repositoryId,
        branch,
      })
      .then((r) => r.data.project),

  detachRepository: (projectId: string) =>
    api.delete(`/api/projects/${projectId}/repository`),

  // ----------------------------------------------------------
  // Membres, invitations et permissions spéciales
  // ----------------------------------------------------------
  listMembers: (projectId: string) =>
    api
      .get<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`)
      .then((r) => r.data.members),

  listInvitations: (projectId: string) =>
    api
      .get<{ invitations: ProjectInvitation[] }>(
        `/api/projects/${projectId}/invitations`,
      )
      .then((r) => r.data.invitations),

  inviteMember: (
    projectId: string,
    data: { email: string; role: ProjectRole; expiresInDays?: number },
  ) =>
    api
      .post<{ invitation: ProjectInvitation; token: string }>(
        `/api/projects/${projectId}/invitations`,
        data,
      )
      .then((r) => r.data),

  resendInvitation: (projectId: string, invitationId: string) =>
    api
      .post<{ token: string; expiresAt: string }>(
        `/api/projects/${projectId}/invitations/${invitationId}/resend`,
      )
      .then((r) => r.data),

  revokeInvitation: (projectId: string, invitationId: string) =>
    api.delete(`/api/projects/${projectId}/invitations/${invitationId}`),

  acceptInvitation: (token: string) =>
    api
      .post<{ member: ProjectMember }>("/api/projects/invitations/accept", {
        token,
      })
      .then((r) => r.data.member),

  updateMemberRole: (
    projectId: string,
    memberId: string,
    role: ProjectRole,
  ) =>
    api
      .patch<{ member: ProjectMember }>(
        `/api/projects/${projectId}/members/${memberId}`,
        { role },
      )
      .then((r) => r.data.member),

  removeMember: (projectId: string, memberId: string) =>
    api.delete(`/api/projects/${projectId}/members/${memberId}`),

  listPermissionGrants: (projectId: string) =>
    api
      .get<{ grants: PermissionGrant[] }>(
        `/api/projects/${projectId}/permission-grants`,
      )
      .then((r) => r.data.grants),

  grantPermission: (
    projectId: string,
    data: {
      userId: string;
      permission: SpecialPermission;
      scopeType?: "PROJECT";
      expiresAt?: string | null;
    },
  ) =>
    api
      .post<{ grant: PermissionGrant }>(
        `/api/projects/${projectId}/permission-grants`,
        { ...data, scopeType: "PROJECT" },
      )
      .then((r) => r.data.grant),

  revokePermission: (projectId: string, grantId: string) =>
    api.delete(`/api/projects/${projectId}/permission-grants/${grantId}`),

  // ----------------------------------------------------------
  // Équipes GitHub associées (rôle interne uniquement)
  // ----------------------------------------------------------
  listTeams: (projectId: string) =>
    api
      .get<{ items: ProjectTeamLink[] }>(`/api/projects/${projectId}/teams`)
      .then((r) => r.data.items),

  listAvailableTeams: (projectId: string) =>
    api
      .get<{ items: GitHubTeam[] }>(
        `/api/projects/${projectId}/teams/available`,
      )
      .then((r) => r.data.items),

  associateTeam: (
    projectId: string,
    githubTeamId: string,
    role: ProjectTeamRole,
  ) =>
    api
      .post<{ link: ProjectTeamLink }>(`/api/projects/${projectId}/teams`, {
        githubTeamId,
        role,
      })
      .then((r) => r.data.link),

  updateTeamRole: (
    projectId: string,
    linkId: string,
    role: ProjectTeamRole,
  ) =>
    api
      .patch<{ link: ProjectTeamLink }>(
        `/api/projects/${projectId}/teams/${linkId}`,
        { role },
      )
      .then((r) => r.data.link),

  removeTeam: (projectId: string, linkId: string) =>
    api.delete(`/api/projects/${projectId}/teams/${linkId}`),
};