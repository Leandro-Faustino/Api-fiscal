import { describe, expect, it, vi } from 'vitest';
import type { EcacAlertNotificationRepository } from '../application/ports/ecac-alert-notification-repository.js';
import {
  ListEcacNotificationEventsUseCase,
  ListEcacNotificationPreferencesUseCase,
  MarkEcacNotificationEventDeliveredUseCase,
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
      title: 'Débito identificado',
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
    claimPendingEvents: vi.fn(async () => []),
    markEventDeliveredByWorker: vi.fn(async () => null),
    markEventFailedByWorker: vi.fn(async () => null),
    ...overrides,
  };
}

describe('notificações de alertas e-CAC', () => {
  it('lista preferências do usuário autenticado', async () => {
    const listPreferences = vi.fn(async () => []);
    const useCase = new ListEcacNotificationPreferencesUseCase({
      ecacAlertNotificationRepository: repository({ listPreferences }),
    });

    await expect(useCase.execute(tenantId, userId)).resolves.toEqual([]);
    expect(listPreferences).toHaveBeenCalledWith(tenantId, userId);
  });

  it('valida canal e severidade antes de gravar preferência', async () => {
    const upsertPreference = vi.fn(repository().upsertPreference);
    const useCase = new UpdateEcacNotificationPreferenceUseCase({
      ecacAlertNotificationRepository: repository({ upsertPreference }),
    });

    await expect(
      useCase.execute({
        tenantId,
        userId,
        channel: 'EMAIL',
        enabled: true,
        minimumSeverity: 'CRITICAL',
        includeResolved: true,
      }),
    ).resolves.toMatchObject({
      channel: 'EMAIL',
      enabled: true,
      minimumSeverity: 'CRITICAL',
      includeResolved: true,
    });
    expect(upsertPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        userId,
        channel: 'EMAIL',
        minimumSeverity: 'CRITICAL',
      }),
    );
  });

  it('rejeita filtro de evento inválido sem consultar o repositório', async () => {
    const listEvents = vi.fn();
    const useCase = new ListEcacNotificationEventsUseCase({
      ecacAlertNotificationRepository: repository({ listEvents }),
    });

    expect(() =>
      useCase.execute(tenantId, userId, { status: 'OPEN' as never }),
    ).toThrowError('Status de evento de notificação inválido.');
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('resume eventos do usuário autenticado', async () => {
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

  it('marca evento do próprio usuário como entregue', async () => {
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
});
