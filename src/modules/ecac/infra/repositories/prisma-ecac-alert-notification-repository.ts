import {
  type EcacAlertNotificationEvent as PrismaEcacAlertNotificationEvent,
  type EcacAlertNotificationPreference as PrismaEcacAlertNotificationPreference,
  type PrismaClient,
} from '@prisma/client';
import { NotFoundError } from '../../../../shared/domain/app-error.js';
import type {
  EcacAlertNotificationEvent,
  EcacAlertNotificationPreference,
} from '../../domain/ecac-radar.js';
import type {
  EcacAlertNotificationRepository,
  ListEcacNotificationEventsFilter,
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
    deliveredAt: row.deliveredAt,
    failedAt: row.failedAt,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    const rows = await this.prisma.ecacAlertNotificationEvent.findMany({
      where: {
        tenantId,
        userId,
        ...(filter.channel ? { channel: filter.channel } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(toEvent);
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
}
