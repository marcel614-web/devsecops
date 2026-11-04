// apps/api/src/modules/github/teams.schema.ts
import { z } from "zod";

const installationId = z
  .string()
  .regex(/^\d+$/, "Identifiant d'installation GitHub invalide");

const teamSlug = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/i,
    "Slug d'équipe invalide (lettres, chiffres et tirets uniquement)",
  );

const gitHubUsername = z
  .string()
  .min(1)
  .max(39)
  .regex(
    /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/,
    "Nom d'utilisateur GitHub invalide",
  );

const repoOwner = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, "Nom de propriétaire de dépôt invalide");

const repoName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, "Nom de dépôt invalide");

export const installationParamSchema = z.object({
  installationId,
});

export const teamParamSchema = z.object({
  installationId,
  slug: teamSlug,
});

export const teamMemberParamSchema = z.object({
  installationId,
  slug: teamSlug,
  username: gitHubUsername,
});

export const teamRepoParamSchema = z.object({
  installationId,
  slug: teamSlug,
  owner: repoOwner,
  repo: repoName,
});

export const teamProjectLinkParamSchema = z.object({
  installationId,
  slug: teamSlug,
  linkId: z.string().min(1).max(64),
});

export const listTeamsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  privacy: z.enum(["secret", "closed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const createTeamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom de l'équipe est obligatoire")
    .max(100, "Le nom de l'équipe ne peut pas dépasser 100 caractères")
    .regex(
      /^[^\u0000-\u001f\u007f]+$/,
      "Le nom de l'équipe contient des caractères de contrôle",
    ),
  description: z
    .string()
    .trim()
    .max(255, "La description ne peut pas dépasser 255 caractères")
    .optional(),
  privacy: z.enum(["secret", "closed"]),
  parentTeamId: z
    .string()
    .regex(/^\d+$/, "Identifiant d'équipe parente invalide")
    .optional(),
  maintainers: z.array(gitHubUsername).max(20).optional(),
  repoFullNames: z
    .array(
      z
        .string()
        .regex(
          /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
          "Format attendu : organisation/dépôt",
        ),
    )
    .max(100)
    .optional(),
  notificationSetting: z
    .enum(["notifications_enabled", "notifications_disabled"])
    .optional(),
});

export const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  role: z.enum(["member", "maintainer"]).optional(),
});

export const addMemberSchema = z.object({
  username: gitHubUsername,
  role: z.enum(["member", "maintainer"]).default("member"),
});

export const listReposQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const setRepoPermissionSchema = z.object({
  permission: z.enum(["pull", "triage", "push", "maintain", "admin"]),
});

export const projectTeamRoleSchema = z.enum([
  "OWNER",
  "MAINTAINER",
  "DEVELOPER",
  "SECURITY_ANALYST",
  "VIEWER",
]);

export const associateProjectTeamSchema = z.object({
  githubTeamId: z.string().min(1).max(64),
  role: projectTeamRoleSchema.default("VIEWER"),
});

export const associateTeamProjectSchema = z.object({
  projectId: z.string().min(1).max(64),
  role: projectTeamRoleSchema.default("VIEWER"),
});

export const updateProjectTeamRoleSchema = z.object({
  role: projectTeamRoleSchema,
});

export const projectTeamLinkParamSchema = z.object({
  id: z.string().min(1).max(64),
  linkId: z.string().min(1).max(64),
});

export type CreateTeamBody = z.infer<typeof createTeamSchema>;
export type AddMemberBody = z.infer<typeof addMemberSchema>;
export type ListTeamsQuery = z.infer<typeof listTeamsQuerySchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
