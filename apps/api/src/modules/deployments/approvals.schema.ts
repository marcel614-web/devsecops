// apps/api/src/modules/deployments/approvals.schema.ts
import { z } from "zod";
import { DeploymentApprovalStatus } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";

export const approvalListQuerySchema = z.object({
  status: z.nativeEnum(DeploymentApprovalStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export const approvalIdParamSchema = z.object({
  id: z.string().min(1),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().max(1000).optional(),
});

export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
