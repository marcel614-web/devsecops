// apps/api/src/modules/projects/project-members.schema.ts
import { z } from "zod";
import {
  PermissionScopeType,
  ProjectRole,
  SpecialPermission,
} from "@prisma/client";

export const projectMemberParamSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
});

export const projectInvitationParamSchema = z.object({
  id: z.string().min(1),
  invitationId: z.string().min(1),
});

export const inviteProjectMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
  role: z.nativeEnum(ProjectRole),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const updateProjectMemberRoleSchema = z.object({
  role: z.nativeEnum(ProjectRole),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(20).max(500),
});

export const grantSpecialPermissionSchema = z.object({
  userId: z.string().min(1),
  permission: z.nativeEnum(SpecialPermission),
  scopeType: z.nativeEnum(PermissionScopeType).default(PermissionScopeType.PROJECT),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const grantGlobalSpecialPermissionSchema =
  grantSpecialPermissionSchema.extend({
    scopeType: z.literal(PermissionScopeType.GLOBAL).default(
      PermissionScopeType.GLOBAL,
    ),
  });

export const revokeSpecialPermissionParamSchema = z.object({
  grantId: z.string().min(1),
});

export type InviteProjectMemberInput = z.infer<typeof inviteProjectMemberSchema>;
export type UpdateProjectMemberRoleInput = z.infer<
  typeof updateProjectMemberRoleSchema
>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type GrantSpecialPermissionInput = z.infer<
  typeof grantSpecialPermissionSchema
>;
