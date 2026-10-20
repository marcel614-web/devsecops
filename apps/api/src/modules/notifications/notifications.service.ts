// apps/api/src/modules/notifications/notifications.service.ts
import {
  NotificationKind,
  PipelineStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { NotFoundError } from "../../utils/errors";
import type {
  ClearNotificationsQuery,
  MarkNotificationInput,
  NotificationListQuery,
} from "./notifications.schema";

export interface ActorContext {
  id: string;
  role: Role;
}

const SYNC_TTL_MS = 5_000;
const lastSyncByUser = new Map<string, number>();
const syncInFlight = new Map<string, Promise<void>>();

interface PipelineForNotification {
  id: string;
  status: PipelineStatus;
  commitSha: string;
  branch: string;
  createdAt: Date;
  finishedAt: Date | null;
  project: { id: string; name: string };
}

function buildPipelineNotification(
  pipeline: PipelineForNotification,
  userId: string,
): Prisma.NotificationCreateManyInput {
  const shortSha = pipeline.commitSha
    ? pipeline.commitSha.slice(0, 7)
    : "inconnu";
  const base = {
    userId,
    sourceKey: `pipeline:${pipeline.id}`,
    link: `/projects/${pipeline.project.id}/pipelines/${pipeline.id}`,
    createdAt: pipeline.finishedAt ?? pipeline.createdAt,
  };

  if (pipeline.status === PipelineStatus.FAILED) {
    return {
      ...base,
      kind: NotificationKind.DANGER,
      title: `Pipeline échoué sur ${pipeline.project.name}`,
      message: `Le pipeline ${shortSha} sur la branche ${pipeline.branch} a échoué.`,
    };
  }

  if (pipeline.status === PipelineStatus.SECURITY_BLOCKED) {
    return {
      ...base,
      kind: NotificationKind.WARNING,
      title: `Security Gate a bloqué le pipeline sur ${pipeline.project.name}`,
      message: `Le pipeline ${shortSha} sur la branche ${pipeline.branch} a été bloqué par le Security Gate.`,
    };
  }

  return {
    ...base,
    kind: NotificationKind.SUCCESS,
    title: `Pipeline réussi sur ${pipeline.project.name}`,
    message: `Le pipeline ${shortSha} sur la branche ${pipeline.branch} s'est terminé avec succès.`,
  };
}

/**
 * Crée (de façon idempotente) les notifications correspondant aux pipelines
 * terminaux visibles par l'utilisateur. Le throttle évite de refaire ce travail
 * à chaque requête de la cloche, de la page et du badge.
 */
async function syncNotifications(actor: ActorContext): Promise<void> {
  const lastSync = lastSyncByUser.get(actor.id) ?? 0;
  if (Date.now() - lastSync < SYNC_TTL_MS) return;

  const running = syncInFlight.get(actor.id);
  if (running) return running;

  const sync = (async () => {
    try {
      const where: Prisma.PipelineWhereInput = {
        status: {
          in: [
            PipelineStatus.SUCCESS,
            PipelineStatus.FAILED,
            PipelineStatus.SECURITY_BLOCKED,
          ],
        },
      };
      if (actor.role !== Role.ADMIN) {
        where.project = { ownerId: actor.id };
      }

      const pipelines = await prisma.pipeline.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          status: true,
          commitSha: true,
          branch: true,
          createdAt: true,
          finishedAt: true,
          project: { select: { id: true, name: true } },
        },
      });

      if (pipelines.length > 0) {
        await prisma.notification.createMany({
          data: pipelines.map((pipeline) =>
            buildPipelineNotification(pipeline, actor.id),
          ),
          skipDuplicates: true,
        });
      }

      // Le TTL ne démarre qu'après une synchronisation réussie.
      lastSyncByUser.set(actor.id, Date.now());
    } finally {
      syncInFlight.delete(actor.id);
    }
  })();

  syncInFlight.set(actor.id, sync);
  return sync;
}

function buildWhere(
  actor: ActorContext,
  query: NotificationListQuery,
): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    deletedAt: null,
  };

  if (query.kind) where.kind = query.kind;
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: "insensitive" } },
      { message: { contains: query.search, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function listNotifications(
  actor: ActorContext,
  query: NotificationListQuery,
) {
  await syncNotifications(actor);

  const baseWhere = buildWhere(actor, query);
  const where: Prisma.NotificationWhereInput = { ...baseWhere };
  if (query.status === "unread") where.readAt = null;
  if (query.status === "read") where.readAt = { not: null };

  const skip = (query.page - 1) * query.pageSize;
  const globalWhere: Prisma.NotificationWhereInput = {
    userId: actor.id,
    deletedAt: null,
  };

  const [
    items,
    total,
    allCount,
    unreadCount,
    readCount,
    globalAll,
    globalUnread,
    globalRead,
  ] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      select: {
        id: true,
        kind: true,
        title: true,
        message: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: baseWhere }),
    prisma.notification.count({ where: { ...baseWhere, readAt: null } }),
    prisma.notification.count({
      where: { ...baseWhere, readAt: { not: null } },
    }),
    prisma.notification.count({ where: globalWhere }),
    prisma.notification.count({
      where: { ...globalWhere, readAt: null },
    }),
    prisma.notification.count({
      where: { ...globalWhere, readAt: { not: null } },
    }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
    unreadCount,
    counts: {
      all: allCount,
      unread: unreadCount,
      read: readCount,
    },
    globalCounts: {
      all: globalAll,
      unread: globalUnread,
      read: globalRead,
    },
  };
}

export async function getUnreadCount(actor: ActorContext) {
  await syncNotifications(actor);

  const count = await prisma.notification.count({
    where: {
      userId: actor.id,
      deletedAt: null,
      readAt: null,
    },
  });

  return { count };
}

export async function markNotificationRead(
  actor: ActorContext,
  notificationId: string,
  input: MarkNotificationInput,
) {
  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId: actor.id,
      deletedAt: null,
    },
    data: {
      readAt: input.read ? new Date() : null,
    },
  });

  if (result.count === 0) {
    throw new NotFoundError("Notification introuvable");
  }

  return { updated: result.count };
}

export async function markAllNotificationsRead(actor: ActorContext) {
  const result = await prisma.notification.updateMany({
    where: {
      userId: actor.id,
      deletedAt: null,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  return { updated: result.count };
}

export async function deleteNotification(
  actor: ActorContext,
  notificationId: string,
) {
  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId: actor.id,
      deletedAt: null,
    },
    data: {
      deletedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new NotFoundError("Notification introuvable");
  }

  return { deleted: result.count };
}

export async function clearNotifications(
  actor: ActorContext,
  scope: ClearNotificationsQuery["scope"],
) {
  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    deletedAt: null,
  };
  if (scope === "read") {
    where.readAt = { not: null };
  }

  const result = await prisma.notification.updateMany({
    where,
    data: {
      deletedAt: new Date(),
    },
  });

  return { deleted: result.count };
}
