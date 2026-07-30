import {
  type EcacAlertNotificationEvent as PrismaEcacAlertNotificationEvent,
  type EcacAlertNotificationPreference as PrismaEcacAlertNotificationPreference,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { NotFoundError } from '../../../../shared/domain/app-error.js';
import type {
  EcacAlertNotificationEvent,
  EcacAlertNotificationPreference,
  EcacNotificationEventSummary,
} from '../../domain/ecac-radar.js';
import type {
  EcacAlertNotificationRepository,
  ClaimEcacNotificationEventsInput,
  ListEcacNotificationEventsFilter,
  MarkEcacNotificationEventFailedInput,
  UpsertEcacNotificationPreferenceInput,
} from '../../application/ports/ecac-alert-notification-repository.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

function toPreference(
  row: PrismaEcacAlertNotificationPreference,
): EcacAlertNotificationPreference {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    channel: row.channel,
    enabled: row.enabled,
    minimumSeverity: row.minimumSeverity,
    includeResolved: row.includeResolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEvent(
  row: PrismaEcacAlertNotificationEvent,
): EcacAlertNotificationEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    alertId: row.alertId,
    userId: row.userId,
    companyId: row.companyId,
    queryType: row.queryType,
    channel: row.channel,
    status: row.status,
    changeType: row.changeType,
    severity: row.severity,
    title: row.title,
    scheduledAt: row.scheduledAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    processingStartedAt: row.processingStartedAt,
    lastAttemptedAt: row.lastAttemptedAt,
    deliveredAt: row.deliveredAt,
    failedAt: row.failedAt,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function emptySummary(): EcacNotificationEventSummary {
  return {
    total: 0,
    byStatus: {
      PENDING: 0,
      PROCESSING: 0,
      DELIVERED: 0,
      FAILED: 0,
    },
    byChannel: {
      IN_APP: 0,
      EMAIL: 0,
    },
    nextPendingAt: null,
    lastDeliveredAt: null,
    lastFailedAt: null,
    lastFailureCode: null,
  };
}

export class PrismaEcacAlertNotificationRepository
  implements EcacAlertNotificationRepository
{
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async listPreferences(
    tenantId: string,
    userId: string,
  ): Promise<EcacAlertNotificationPreference[]> {
    const rows = await this.prisma.ecacAlertNotificationPreference.findMany({
      where: { tenantId, userId },
      orderBy: { channel: 'asc' },
    });
    return rows.map(toPreference);
  }

  public async upsertPreference(
    input: UpsertEcacNotificationPreferenceInput,
  ): Promise<EcacAlertNotificationPreference> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.count({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          status: 'ACTIVE',
        },
      });
      if (membership !== 1) {
        throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
      }

      const row = await transaction.ecacAlertNotificationPreference.upsert({
        where: {
          tenantId_userId_channel: {
            tenantId: input.tenantId,
            userId: input.userId,
            channel: input.channel,
          },
        },
        create: {
          tenantId: input.tenantId,
          userId: input.userId,
          channel: input.channel,
          enabled: input.enabled,
          minimumSeverity: input.minimumSeverity,
          includeResolved: input.includeResolved,
        },
        update: {
          enabled: input.enabled,
          minimumSeverity: input.minimumSeverity,
          includeResolved: input.includeResolved,
          updatedAt: input.updatedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.userId,
          action: 'ecac.notification_preference.updated',
          entityType: 'ecac_alert_notification_preference',
          entityId: row.id,
          metadata: {
            channel: input.channel,
            enabled: input.enabled,
            minimumSeverity: input.minimumSeverity,
            includeResolved: input.includeResolved,
          },
        },
      });
      return toPreference(row);
    });
  }

  public async listEvents(
    tenantId: string,
    userId: string,
    filter: ListEcacNotificationEventsFilter = {},
  ): Promise<EcacAlertNotificationEvent[]> {
    const scheduledAt =
      filter.scheduledFrom || filter.scheduledTo
        ? {
            ...(filter.scheduledFrom ? { gte: filter.scheduledFrom } : {}),
            ...(filter.scheduledTo ? { lte: filter.scheduledTo } : {}),
          }
        : undefined;
    const rows = await this.prisma.ecacAlertNotificationEvent.findMany({
      where: {
        tenantId,
        userId,
        ...(filter.channel ? { channel: filter.channel } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.companyId ? { companyId: filter.companyId } : {}),
        ...(filter.queryType ? { queryType: filter.queryType } : {}),
        ...(filter.severity ? { severity: filter.severity } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
      },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit ?? 50,
    });
    return rows.map(toEvent);
  }

  public async summarizeEvents(
    tenantId: string,
    userId: string,
  ): Promise<EcacNotificationEventSummary> {
    const [
      statusRows,
      channelRows,
      nextPending,
      lastDelivered,
      lastFailed,
    ] = await Promise.all([
      this.prisma.ecacAlertNotificationEvent.groupBy({
        by: ['status'],
        where: { tenantId, userId },
        _count: { id: true },
      }),
      this.prisma.ecacAlertNotificationEvent.groupBy({
        by: ['channel'],
        where: { tenantId, userId },
        _count: { id: true },
      }),
      this.prisma.ecacAlertNotificationEvent.findFirst({
        where: { tenantId, userId, status: 'PENDING' },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
        select: { scheduledAt: true },
      }),
      this.prisma.ecacAlertNotificationEvent.findFirst({
        where: { tenantId, userId, status: 'DELIVERED', deliveredAt: { not: null } },
        orderBy: [{ deliveredAt: 'desc' }, { updatedAt: 'desc' }],
        select: { deliveredAt: true },
      }),
      this.prisma.ecacAlertNotificationEvent.findFirst({
        where: { tenantId, userId, status: 'FAILED', failedAt: { not: null } },
        orderBy: [{ failedAt: 'desc' }, { updatedAt: 'desc' }],
        select: { failedAt: true, failureCode: true },
      }),
    ]);
    const summary = emptySummary();
    for (const row of statusRows) {
      summary.byStatus[row.status] = row._count.id;
      summary.total += row._count.id;
    }
    for (const row of channelRows) {
      summary.byChannel[row.channel] = row._count.id;
    }
    summary.nextPendingAt = nextPending?.scheduledAt ?? null;
    summary.lastDeliveredAt = lastDelivered?.deliveredAt ?? null;
    summary.lastFailedAt = lastFailed?.failedAt ?? null;
    summary.lastFailureCode = lastFailed?.failureCode ?? null;
    return summary;
  }

  public async markEventDelivered(
    tenantId: string,
    userId: string,
    eventId: string,
    deliveredAt: Date,
  ): Promise<EcacAlertNotificationEvent> {
    const row = await this.prisma.ecacAlertNotificationEvent.findUnique({
      where: { tenantId_id: { tenantId, id: eventId } },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundError(
        'Evento de notificação e-CAC não encontrado.',
        'ECAC_NOTIFICATION_EVENT_NOT_FOUND',
      );
    }
    if (row.status === 'DELIVERED') {
      return toEvent(row);
    }
    return this.prisma.$transaction(async (transaction) => {
      const delivered = await transaction.ecacAlertNotificationEvent.update({
        where: { tenantId_id: { tenantId, id: eventId } },
        data: {
          status: 'DELIVERED',
          deliveredAt,
          failedAt: null,
          failureCode: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'ecac.notification_event.delivered',
          entityType: 'ecac_alert_notification_event',
          entityId: eventId,
          metadata: {
            alertId: delivered.alertId,
            channel: delivered.channel,
            changeType: delivered.changeType,
          },
        },
      });
      return toEvent(delivered);
    });
  }

  public async claimPendingEvents(
    input: ClaimEcacNotificationEventsInput,
  ): Promise<EcacAlertNotificationEvent[]> {
    if (input.limit < 1) {
      return [];
    }
    const limit = Math.min(Math.trunc(input.limit), 100);
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "ecac_alert_notification_events"
        SET
          "status" = 'PROCESSING'::"EcacNotificationEventStatus",
          "attempt_count" = "attempt_count" + 1,
          "processing_started_at" = ${input.claimedAt},
          "last_attempted_at" = ${input.claimedAt},
          "updated_at" = ${input.claimedAt}
        WHERE "id" IN (
          SELECT "id"
          FROM "ecac_alert_notification_events"
          WHERE (
            ("status" = 'PENDING'::"EcacNotificationEventStatus" AND "scheduled_at" <= ${input.claimedAt})
            OR
            ("status" = 'PROCESSING'::"EcacNotificationEventStatus" AND "processing_started_at" <= ${input.staleProcessingBefore})
          )
          ORDER BY "scheduled_at" ASC, "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        RETURNING "id"
      `);
      if (claimed.length === 0) {
        return [];
      }
      const rows = await transaction.ecacAlertNotificationEvent.findMany({
        where: { id: { in: claimed.map((event) => event.id) } },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(toEvent);
    });
  }

  public async markEventDeliveredByWorker(
    tenantId: string,
    eventId: string,
    deliveredAt: Date,
  ): Promise<EcacAlertNotificationEvent | null> {
    const row = await this.prisma.ecacAlertNotificationEvent.findUnique({
      where: { tenantId_id: { tenantId, id: eventId } },
    });
    if (!row) {
      return null;
    }
    if (row.status === 'DELIVERED') {
      return toEvent(row);
    }
    return this.prisma.$transaction(async (transaction) => {
      const delivered = await transaction.ecacAlertNotificationEvent.update({
        where: { tenantId_id: { tenantId, id: eventId } },
        data: {
          status: 'DELIVERED',
          deliveredAt,
          failedAt: null,
          failureCode: null,
          processingStartedAt: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId: null,
          action: 'ecac.notification_event.worker_delivered',
          entityType: 'ecac_alert_notification_event',
          entityId: eventId,
          metadata: {
            alertId: delivered.alertId,
            channel: delivered.channel,
            changeType: delivered.changeType,
          },
        },
      });
      return toEvent(delivered);
    });
  }

  public async markEventFailedByWorker(
    input: MarkEcacNotificationEventFailedInput,
  ): Promise<EcacAlertNotificationEvent | null> {
    const row = await this.prisma.ecacAlertNotificationEvent.findUnique({
      where: {
        tenantId_id: { tenantId: input.tenantId, id: input.eventId },
      },
    });
    if (!row) {
      return null;
    }
    const retryAt = input.retryAt ?? null;
    return this.prisma.$transaction(async (transaction) => {
      const failed = await transaction.ecacAlertNotificationEvent.update({
        where: {
          tenantId_id: { tenantId: input.tenantId, id: input.eventId },
        },
        data: {
          status: retryAt ? 'PENDING' : 'FAILED',
          scheduledAt: retryAt ?? row.scheduledAt,
          failedAt: input.failedAt,
          failureCode: input.failureCode,
          processingStartedAt: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: null,
          action: retryAt
            ? 'ecac.notification_event.worker_retry_scheduled'
            : 'ecac.notification_event.worker_failed',
          entityType: 'ecac_alert_notification_event',
          entityId: input.eventId,
          metadata: {
            alertId: failed.alertId,
            channel: failed.channel,
            changeType: failed.changeType,
            failureCode: input.failureCode,
            retryAt: retryAt?.toISOString() ?? null,
          },
        },
      });
      return toEvent(failed);
    });
  }
}
