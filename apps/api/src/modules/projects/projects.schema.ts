// apps/api/src/modules/projects/projects.schema.ts
import { z } from "zod";
import {
  GitProvider,
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
    stagingPort: z.number().int().min(1).max(65535).optional(),
    autoRollback: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Au moins un champ à modifier est requis",
  });

export const createGateExceptionSchema = z.object({
  category: z
    .enum(["ALL", "SECRET", "SAST", "SCA", "IMAGE", "IAC", "DAST"])
    .default("ALL"),
  severity: z.nativeEnum(Severity).nullable().optional(),
  reason: z.string().trim().min(1).max(1000),
  expiresAt: z.coerce.date().nullable().optional(),
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