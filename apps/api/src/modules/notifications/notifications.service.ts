import { PipelineStatus, Role } from "@prisma/client";
import { prisma } from "../../utils/prisma";

export interface ActorContext {
  id: string;
  role: Role;
}

export async function listNotifications(actor: ActorContext) {
  const where =
    actor.role === Role.ADMIN ? {} : { project: { ownerId: actor.id } };

  const pipelines = await prisma.pipeline.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      project: { select: { id: true, name: true } },
    },
  });

  const notifications: Array<{
    id: string;
    title: string;
    kind: "success" | "warning" | "danger" | "info";
    time: string;
    link?: string;
  }> = [];

  for (const p of pipelines) {
    if (p.status === PipelineStatus.FAILED) {
      notifications.push({
        id: `pipe-fail-${p.id}`,
        title: `Pipeline échoué sur ${p.project.name}`,
        kind: "danger",
        time: p.createdAt.toISOString(),
        link: `/projects/${p.project.id}/pipelines/${p.id}`,
      });
    }
    if (p.status === PipelineStatus.SECURITY_BLOCKED) {
      notifications.push({
        id: `pipe-blocked-${p.id}`,
        title: `Security Gate a bloqué le pipeline sur ${p.project.name}`,
        kind: "warning",
        time: p.createdAt.toISOString(),
        link: `/projects/${p.project.id}/pipelines/${p.id}`,
      });
    }
    if (p.status === PipelineStatus.SUCCESS) {
      notifications.push({
        id: `pipe-success-${p.id}`,
        title: `Pipeline réussi sur ${p.project.name}`,
        kind: "success",
        time: p.createdAt.toISOString(),
        link: `/projects/${p.project.id}/pipelines/${p.id}`,
      });
    }
  }

  return notifications.slice(0, 20);
}