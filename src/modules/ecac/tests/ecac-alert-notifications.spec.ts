import { describe, expect, it, vi } from 'vitest';
import type { EcacAlertNotificationRepository } from '../application/ports/ecac-alert-notification-repository.js';
import {
  GetEcacNotificationEventUseCase,
  ListEcacNotificationEventAuditUseCase,
  ListEcacNotificationEventsUseCase,
  ListEcacNotificationPreferencesUseCase,
  MarkEcacNotificationEventDeliveredUseCase,
  RetryEcacNotificationEventUseCase,
  SummarizeEcacNotificationEventsUseCase,
  UpdateEcacNotificationPreferenceUseCase,
} from '../application/use-cases/manage-ecac-alert-notifications.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000002';
const eventId = '10000000-0000-4000-8000-000000000003';
const now = new Date('2026-07-26T18:00:00.000Z');

function repository(
  overrides: Partial<EcacAlertNotificationRepository> = {},
): EcacAlertNotificationRepository {
  return {
    listPreferences: vi.fn(async () => []),
    upsertPreference: vi.fn(async (input) => ({
      id: '10000000-0000-4000-8000-000000000004',
      tenantId: input.tenantId,
      userId: input.userId,
      channel: input.channel,
      enabled: input.enabled,
      minimumSeverity: input.minimumSeverity,
      includeResolved: input.includeResolved,
      createdAt: now,
      updatedAt: input.updatedAt,
    })),
    listEvents: vi.fn(async () => []),
    getEvent: vi.fn(async (tenant, user, event) => ({
      id: event,
      tenantId: tenant,
      alertId: '10000000-0000-4000-8000-000000000005',
      userId: user,
      companyId: '10000000-0000-4000-8000-000000000006',
      queryType: 'TAX_STATUS' as const,
      channel: 'IN_APP' as const,
      status: 'PENDING' as const,
      changeType: 'NEW' as const,
      severity: 'CRITICAL' as const,
      title: 'DÃ©bito identificado',
      scheduledAt: now,
      attemptCount: 0,
      maxAttempts: 3,
      processingStartedAt: null,
      lastAttemptedAt: null,
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    })),
    listEventAuditTrail: vi.fn(async (tenant, event, limit) => [
      {
        id: '10000000-0000-4000-8000-000000000007',
        tenantId: tenant,
        actorId: userId,
        action: 'ecac.notification_event.retry_scheduled',
        entityType: 'ecac_alert_notification_event',
        entityId: event,
        metadata: { limit },
        occurredAt: now,
      },
    ]),
    summarizeEvents: vi.fn(async () => ({
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
    })),
    markEventDelivered: vi.fn(async (tenant, user, event, deliveredAt) => ({
      id: event,
      tenantId: tenant,
      alertId: '10000000-0000-4000-8000-000000000005',
      userId: user,
      companyId: '10000000-0000-4000-8000-000000000006',
      queryType: 'TAX_STATUS' as const,
      channel: 'IN_APP' as const,
      status: 'DELIVERED' as const,
      changeType: 'NEW' as const,
      severity: 'CRITICAL' as const,
      title: 'DÃ©bito identificado',
      scheduledAt: now,
      attemptCount: 0,
      maxAttempts: 3,
      processingStartedAt: null,
      lastAttemptedAt: null,
      deliveredAt,
      failedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: deliveredAt,
    })),
    retryFailedEvent: vi.fn(async (tenant, user, event, scheduledAt) => ({
      id: event,
      tenantId: tenant,
      alertId: '10000000-0000-4000-8000-000000000005',
      userId: user,
      companyId: '10000000-0000-4000-8000-000000000006',
      queryType: 'TAX_STATUS' as const,
      channel: 'IN_APP' as const,
      status: 'PENDING' as const,
      changeType: 'NEW' as const,
      severity: 'CRITICAL' as const,
      title: 'DÃ©bito identificado',
      scheduledAt,
      attemptCount: 2,
      maxAttempts: 3,
      processingStartedAt: null,
      lastAttemptedAt: now,
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: scheduledAt,
    })),
    claimPendingEvents: vi.fn(async () => []),
    markEventDeliveredByWorker: vi.fn(async () => null),
    markEventFailedByWorker: vi.fn(async () => null),
    ...overrides,
  };
}

describe('notificaÃ§Ãµes de alertas e-CAC', () => {
  it('lista preferÃªncias do usuÃ¡rio autenticado', async () => {
    const listPreferences = vi.fn(async () => []);
    const useCase = new ListEcacNotificationPreferencesUseCase({
      ecacAlertNotificationRepository: repository({ listPreferences }),
    });

    await expect(useCase.execute(tenantId, userId)).resolves.toEqual([]);
    expect(listPreferences).toHaveBeenCalledWith(tenantId, userId);
  });

  it('valida canal e severidade antes de gravar preferÃªncia', async () => {
    const upsertPreference = vi.fn(repository().upsertPreference);
    const useCase = new UpdateEcacNotificationPreferenceUseCase({
      e×¾ö¶‰žËkºwµç`vi.fn(async () => null);
    const listEventAuditTrail = vi.fn();
    const useCase = new ListEcacNotificationEventAuditUseCase({
      ecacAlertNotificationRepository: repository({
        getEvent,
        listEventAuditTrail,
      }),
    });

    await expect(
      useCase.execute(tenantId, userId, eventId),
    ).rejects.toMatchObject({
      code: 'ECAC_NOTIFICATION_EVENT_NOT_FOUND',
    });
    expect(listEventAuditTrail).not.toHaveBeenCalled();
  });

  it('rejeita limite invÃ¡lido ao listar auditoria de evento', async () => {
    const getEvent = vi.fn();
    const listEventAuditTrail = vi.fn();
    const useCase = new ListEcacNotificationEventAuditUseCase({
      ecacAlertNotificationRepository: repository({
        getEvent,
        listEventAuditTrail,
      }),
    });

    await expect(
      useCase.execute(tenantId, userId, eventId, 101),
    ).rejects.toThrowError('A auditoria do evento deve ter limite entre 1 e 100.');
    expect(getEvent).not.toHaveBeenCalled();
    expect(listEventAuditTrail).not.toHaveBeenCalled();
  });

  it('resume eventos do usuÃ¡rio autenticado', async () => {
    const summarizeEvents = vi.fn(async () => ({
      total: 2,
      byStatus: {
        PENDING: 1,
        PROCESSING: 0,
        DELIVERED: 1,
        FAILED: 0,
      },
      byChannel: {
        IN_APP: 1,
        EMAIL: 1,
      },
      nextPendingAt: now,
      lastDeliveredAt: now,
      lastFailedAt: null,
      lastFailureCode: null,
    }));
    const useCase = new SummarizeEcacNotificationEventsUseCase({
      ecacAlertNotificationRepository: repository({ summarizeEvents }),
    });

    await expect(useCase.execute(tenantId, userId)).resolves.toMatchObject({
      total: 2,
      byStatus: { PENDING: 1, DELIVERED: 1 },
      byChannel: { IN_APP: 1, EMAIL: 1 },
    });
    expect(summarizeEvents).toHaveBeenCalledWith(tenantId, userId);
  });

  it('marca evento do prÃ³prio usuÃ¡rio como entregue', async () => {
    const markEventDelivered = vi.fn(repository().markEventDelivered);
    const useCase = new MarkEcacNotificationEventDeliveredUseCase({
      ecacAlertNotificationRepository: repository({ markEventDelivered }),
    });

    const delivered = await useCase.execute(tenantId, userId, eventId);

    expect(delivered).toMatchObject({
      id: eventId,
      status: 'DELIVERED',
      deliveredAt: expect.any(Date),
    });
    expect(markEventDelivered).toHaveBeenCalledWith(
      tenantId,
      userId,
      eventId,
      expect.any(Date),
    );
  });

  it('reagenda evento com falha para nova tentativa', async () => {
    const failedEvent = {
      ...(await repository().getEvent(tenantId, userId, eventId))!,
      status: 'FAILED' as const,
      attemptCount: 2,
      failedAt: now,
      failureCode: 'HTTP_503',
    };
    const getEvent = vi.fn(async () => failedEvent);
    const retryFailedEvent = vi.fn(repository().retryFailedEvent);
    const useCase = new RetryEcacNotificationEventUseCase({
      ecacAlertNotificationRepository: repository({
        getEvent,
        retryFailedEvent,
      }),
    });

    const retried = await useCase.execute(tenantId, userId, eventId);

    expect(retried).toMatchObject({
      id: eventId,
      status: 'PENDING',
      attemptCount: 2,
      failedAt: null,
      failureCode: null,
    });
    expect(retryFailedEvent).toHaveBeenCalledWith(
      tenantId,
      userId,
      eventId,
      expect.any(Date),
    );
  });

  it('rejeita retry de evento que nÃ£o falhou', async () => {
    const retryFailedEvent = vi.fn();
    const useCase = new RetryEcacNotificationEventUseCase({
      ecacAlertNotificationRepository: repository({ retryFailedEvent }),
    });

    await expect(useCase.execute(tenantId, userId, eventId)).rejects.toMatchObject({
      code: 'ECAC_NOTIFICATION_EVENT_NOT_FAILED',
    });
    expect(retryFailedEvent).not.toHaveBeenCalled();
  });
});
