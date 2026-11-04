// apps/api/src/modules/pipelines/pipelines.schema.ts
import { z } from "zod";
import { PipelineStatus, Severity } from "@prisma/client";
import { FULL_GIT_SHA_PATTERN } from "@devsecops/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1),
});

export const projectPipelineParamSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
});

export const pipelineReportParamSchema = projectPipelineParamSchema.extend({
  format: z.enum(["html", "pdf"]),
});

export const pipelineListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.nativeEnum(PipelineStatus).optional(),
  branch: z.string().trim().min(1).max(120).optional(),
});

/**
 * Liste globale des pipelines accessibles à l'utilisateur.
 * `projectId` est optionnel : sans lui, tous les pipelines visibles sont
 * retournés. Les droits sont vérifiés côté service.
 */
export const globalPipelineListQuerySchema = pipelineListQuerySchema.extend({
  projectId: z.string().min(1).optional(),
});

export const runPipelineSchema = z.object({
  // Le SHA est utilisé pour construire le tag Docker, qui part dans une
  // commande shell sur la VM de déploiement : on n'accepte qu'un SHA Git
  // hexadécimal. Sans cette contrainte, un utilisateur DEVELOPER pouvait
  // exécuter des commandes arbitraires sur le serveur de production.
  commitSha: z
    .string()
    .trim()
    .regex(
      FULL_GIT_SHA_PATTERN,
      "Le commit SHA doit être complet (40 ou 64 caractères hexadécimal)",
    )
    .optional(),
  branch: z.string().trim().min(1).max(120).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  trigger: z.string().trim().min(1).max(50).optional(),
  // Contexte pull request conservé lors d'une relance.
  pullRequestNumber: z.number().int().positive().optional(),
  // `z.url()` accepte `javascript:` (URL valide) : on impose HTTPS.
  // `.refine()` renvoie un ZodEffects : il doit être le dernier appel.
  pullRequestUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://"), {
      message: "L'URL de pull request doit être en HTTPS",
    })
    .optional(),
  baseBranch: z.string().trim().min(1).max(120).optional(),
});

export const pipelineLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(500),
  stepId: z.string().min(1).optional(),
  level: z.enum(["info", "warn", "error", "debug"]).optional(),
});

export const pipelineScansQuerySchema = z.object({
  type: z.enum(["SECRET", "SAST", "SCA", "IMAGE", "IAC", "DAST"]).optional(),
});

export const vulnerabilityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  severity: z.nativeEnum(Severity).optional(),
  tool: z.string().trim().min(1).max(50).optional(),
  pipelineId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>;
export type PipelineListQuery = z.infer<typeof pipelineListQuerySchema>;
export type GlobalPipelineListQuery = z.infer<
  typeof globalPipelineListQuerySchema
>;
export type PipelineLogsQuery = z.infer<typeof pipelineLogsQuerySchema>;
export type PipelineScansQuery = z.infer<typeof pipelineScansQuerySchema>;
export type VulnerabilityListQuery = z.infer<typeof vulnerabilityListQuerySchema>;