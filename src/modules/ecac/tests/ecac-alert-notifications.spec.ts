import { describe, expect, it, vi } from 'vitest';
import type { EcacAlertNotificationRepository } from '../application/ports/ecac-alert-notification-repository.js';
import {
  ListEcacNotificationEventsUseCase,
  ListEcacNotificationPreferencesUseCase,
  MarkEcacNotificationEventDeliveredUseCase,
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
      deliveredAt,
      failedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: deliveredAt,
    })),
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
