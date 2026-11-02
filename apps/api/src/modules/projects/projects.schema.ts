// apps/api/src/modules/projects/projects.schema.ts
import { z } from "zod";
import {
  GitProvider,
  SecurityGateExceptionMatchType,
  SecurityGateMode,
  Severity,
  Technology,
} from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

const repoFullNameRegex = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const projectIdParamSchema = z.object({
  id: z.string().min(1),
});

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  technology: z.nativeEnum(Technology).optional(),
  provider: z.nativeEnum(GitProvider).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  provider: z.nativeEnum(GitProvider).default(GitProvider.GITHUB),
  repoFullName: z
    .string()
    .trim()
    .regex(repoFullNameRegex, "Format attendu : owner/repo"),
  repoId: z.string().min(1),
  defaultBranch: z.string().trim().min(1).max(120).default("main"),
  technology: z.nativeEnum(Technology).default(Technology.UNKNOWN),
  deploymentEnabled: z.boolean().default(false),
  serverId: z.string().min(1).optional().nullable(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    defaultBranch: z.string().trim().min(1).max(120).optional(),
    technology: z.nativeEnum(Technology).optional(),
    deploymentEnabled: z.boolean().optional(),
    serverId: z.string().min(1).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export const updateProjectConfigSchema = z
  .object({
    triggerBranches: z.array(z.string().trim().min(1).max(120)).min(1).optional(),
    gitleaksEnabled: z.boolean().optional(),
    semgrepEnabled: z.boolean().optional(),
    scaEnabled: z.boolean().optional(),
    iacEnabled: z.boolean().optional(),
    trivyEnabled: z.boolean().optional(),
    syftEnabled: z.boolean().optional(),
    zapEnabled: z.boolean().optional(),
    cosignEnabled: z.boolean().optional(),
    securityGateCritical: z.number().int().min(0).optional(),
    securityGateHigh: z.number().int().min(0).optional(),
    securityGateMedium: z.number().int().min(0).optional(),
    securityGateLow: z.number().int().min(-1).optional(),
    gateMode: z.nativeEnum(SecurityGateMode).optional(),
    gateEnforcementAt: z.coerce.date().nullable().optional(),
    gateSecretsEnabled: z.boolean().optional(),
    gateSastEnabled: z.boolean().optional(),
    gateScaEnabled: z.boolean().optional(),
    gateIacEnabled: z.boolean().optional(),
    gateImageEnabled: z.boolean().optional(),
    gateDastEnabled: z.boolean().optional(),
    deploymentStrategy: z
      .enum(["direct", "staging_then_production"])
      .optional(),
    stagingPort: z.number().int().min(1).max(65535).nullable().optional(),
    productionPort: z.number().int().min(1).max(65535).nullable().optional(),
    autoRollback: z.boolean().optional(),
    requireProductionApproval: z.boolean().optional(),
    mandatoryControls: z
      .array(z.enum(["SECRET", "SAST", "SCA", "IMAGE", "IAC", "DAST"]))
      .optional(),
    requireExceptionApproval: z.boolean().optional(),
    // Contrôles Ansible : uniquement statiques, jamais d'exécution de
    // playbook via cette configuration.
    ansibleLintEnabled: z.boolean().optional(),
    ansibleSyntaxCheckEnabled: z.boolean().optional(),
    ansibleTimeoutMs: z
      .number()
      .int()
      .min(10_000)
      .max(30 * 60_000)
      .optional(),
    ansibleMaxPlaybooks: z.number().int().min(1).max(100).optional(),
    postDeployChecksEnabled: z.boolean().optional(),
    healthcheckPath: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^\/(?!\/)[^\r\n\\\u0000-\u001f]*$/u, {
        message: "Chemin local requis, commençant par / (sans destination externe)",
      })
      .refine((value) => !value.split("/").includes(".."), {
        message: "Le chemin de healthcheck ne peut pas contenir ..",
      })
      .optional(),
    healthcheckTimeoutMs: z.number().int().min(1000).max(60_000).optional(),
    // Le rescan réutilise BullMQ et n'exécute aujourd'hui que le contrôle
    // IMAGE sur le digest déployé. Aucun autre contrôle n'est prétendu.
    rescanEnabled: z.boolean().optional(),
    rescanIntervalHours: z.number().int().min(1).max(24 * 30).optional(),
    rescanControls: z.array(z.enum(["IMAGE"])).min(1).max(1).optional(),
    rescanTimeoutMs: z
      .number()
      .int()
      .min(30_000)
      .max(60 * 60_000)
      .optional(),
    rescanMaxRunsPerDay: z.number().int().min(1).max(24).optional(),
    rescanRemediationEnabled: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export const createGateExceptionSchema = z.object({
  category: z
    .enum(["ALL", "SECRET", "SAST", "SCA", "IMAGE", "IAC", "DAST"])
    .default("ALL"),
  severity: z.nativeEnum(Severity).nullable().optional(),
  // Cible obligatoire : CVE, GHSA, règle ou empreinte du finding.
  fingerprint: z.string().trim().min(1).max(300),
  matchType: z.nativeEnum(SecurityGateExceptionMatchType).default("ANY"),
  reason: z.string().trim().min(10).max(1000),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const gateExceptionDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "REVOKE"]),
  comment: z.string().trim().max(1000).optional(),
});

export const gateExceptionParamSchema = z.object({
  id: z.string().min(1),
  exceptionId: z.string().min(1),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
export type UpdateProjectConfigInput = z.infer<typeof updateProjectConfigSchema>;
export type CreateGateExceptionInput = z.infer<typeof createGateExceptionSchema>;
export type GateExceptionDecisionInput = z.infer<
  typeof gateExceptionDecisionSchema
>;