import { describe, expect, it, vi } from 'vitest';
import type { EcacAlertNotificationRepository } from '../application/ports/ecac-alert-notification-repository.js';
import type { EcacNotificationDeliveryGateway } from '../application/ports/ecac-notification-delivery-gateway.js';
import {
  type ProcessEcacNotificationEventsResult,
  ProcessEcacNotificationEventsUseCase,
} from '../application/use-cases/process-ecac-notification-events.js';
import type { EcacAlertNotificationEvent } from '../domain/ecac-radar.js';
import { EcacNotificationWorker } from '../infra/workers/ecac-notification-worker.js';
import type { EcacWorkerLogger } from '../infra/workers/ecac-scheduled-worker.js';

const now = new Date('2026-07-26T21:00:00.000Z');
const tenantId = '10000000-0000-4000-8000-000000000001';

function event(
  overrides: Partial<EcacAlertNotificationEvent> = {},
): EcacAlertNotificationEvent {
  return {
    id: '10000000-0000-4000-8000-000000000002',
    tenantId,
    alertId: '10000000-0000-4000-8000-000000000003',
    userId: '10000000-0000-4000-8000-000000000004',
    companyId: '10000000-0000-4000-8000-000000000005',
    queryType: 'TAX_STATUS',
    channel: 'IN_APP',
    status: 'PROCESSING',
    changeType: 'NEW',
    severity: 'CRITICAL',
    title: 'Débito pendente',
    scheduledAt: now,
    attemptCount: 1,
    maxAttempts: 3,
    processingStartedAt: now,
    lastAttemptedAt: now,
    deliveredAt: null,
    failedAt: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function repository(
  events: EcacAlertNotificationEvent[],
  overrides: Partial<EcacAlertNotificationRepository> = {},
): EcacAlertNotificationRepository {
  return {
    listPreferences: vi.fn(async () => []),
    upsertPreference: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listEvents: vi.fn(async () => []),
    getEvent: vi.fn(async () => null),
    listEventAuditTrail: vi.fn(async () => []),
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
    markEventDelivered: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    retryFailedEvent: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    claimPendingEvents: vi.fn(async () => events),
    markEventDeliveredByWorker: vi.fn(async (tenant, id, deliveredAt) => ({
      ...events.find((item) => item.id === id)!,
      tenantId: tenant,
      status: 'DELIVERED' as const,
      deliveredAt,
      processingStartedAt: null,
      updatedAt: deliveredAt,
    })),
    markEventFailedByWorker: vi.fn(async (input) => ({
      ...events.find((item) => item.id === input.eventId)!,
      status: input.retryAt ? ('PENDING' as const) : ('FAILED' as const),
      scheduledAt:
        input.retryAt ?? events.find((item) => item.id === input.eventId)!.scheduledAt,
      failedAt: input.failedAt,
      failureCode: input.failureCode,
      processingStartedAt: null,
      updatedAt: input.failedAt,
    })),
    ...overrides,
  };
}

function gateway(
  overrides: Partial<EcacNotificationDeliveryGateway> = {},
): EcacNotificationDeliveryGateway {
  return {
    deliver: vi.fn(async () => ({ delivered: true })),
    ...overrides,
  };
}

function logger(): EcacWorkerLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe('worker de notificações e-CAC', () => {
  it('reserva eventos pendentes e marca IN_APP como entregue', async () => {
    const pending = event();
    const repo = repository([pending]);
    const delivery = gateway();
    const useCase = new ProcessEcacNotificationEventsUseCase({
      ecacAlertNotificationRepository: repo,
      ecacNotificationDeliveryGateway: delivery,
      ecacNotificationRetryDelayMs: 300_000,
    });

    await expect(useCase.executeScheduled(25, 300_000)).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      retryScheduled: 0,
      missing: 0,
    });
    expect(repo.claimPendingEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 25,
        claimedAt: expect.any(Date),
        staleProcessingBefore: expect.any(Date),
      }),
    );
    expect(delivery.deliver).toHaveBeenCalledWith(pending);
    expect(repo.markEventDeliveredByWorker).toHaveBeenCalledWith(
      tenantId,
      pending.id,
      expect.any(Date),
    );
  });

  it('agenda retry para falha temporária antes do limite de tentativas', async () => {
    const pending = event({ attemptCount: 2, maxAttempts: 3 });
    const repo = repository([pending]);
    const delivery = gateway({
      deliver: vi.fn(async () => ({
        delivered: false,
        failureCode: 'temporary provider error',
        retryable: true,
      })),
    });
    const useCase = new ProcessEcacNotificationEventsUseCase({
      ecacAlertNotificationRepository: repo,
      ecacNotificationDeliveryGateway: delivery,
      ecacNotificationRetryDelayMs: 300_000,
    });

    await expect(useCase.executeScheduled(25, 300_000)).resolves.toMatchObject({
      claimed: 1,
      retryScheduled: 1,
      failed: 0,
    });
    expect(repo.markEventFailedByWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        eventId: pending.id,
        failureCode: 'TEMPORARY_PROVIDER_ERROR',
        retryAt: expect.any(Date),
      }),
    );
  });

  it('fecha como falha terminal quando o canal não tem provedor', async () => {
    const pending = event({ channel: 'EMAIL', attemptCount: 1, maxAttempts: 3 });
    const repo = repository([pending]);
    const delivery = gateway({
      deliver: vi.fn(async () => ({
        delivered: false,
        failureCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
        retryable: false,
      })),
    });
    const useCase = new ProcessEcacNotificationEventsUseCase({
      ecacAlertNotificationRepository: repo,
      ecacNotificationDeliveryGateway: delivery,
      ecacNotificationRetryDelayMs: 300_000,
    });

    await expect(useCase.executeScheduled(25, 300_000)).resolves.toMatchObject({
      claimed: 1,
      retryScheduled: 0,
      failed: 1,
    });
    expect(repo.markEventFailedByWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
        retryAt: null,
      }),
    );
  });

  it('executa um ciclo do worker sem expor mensagem interna de erro', async () => {
    const workerLogger = logger();
    const executeScheduled = vi.fn(async () => {
      throw new Error('payload sensível do provedor');
    });
    const worker = new EcacNotificationWorker({
      processEcacNotificationEventsUseCase: { executeScheduled },
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      processingTtlMs: 300_000,
    });

    await expect(worker.runCycle()).resolves.toBeNull();
    expect(workerLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'Error',
        errorCode: null,
      }),
      'ecac.notification_worker.cycle.failed',
    );
    expect(JSON.stringify(vi.mocked(workerLogger.error).mock.calls)).not.toContain(
      'payload sensível',
    );
  });

  it('não sobrepõe ciclos e encerra depois do ciclo atual', async () => {
    const workerLogger = logger();
    let completeCycle!: (result: ProcessEcacNotificationEventsResult) => void;
    const pendingCycle = new Promise<ProcessEcacNotificationEventsResult>(
      (resolve) => {
        completeCycle = resolve;
      },
    );
    const executeScheduled = vi.fn(async () => pendingCycle);
    const worker = new EcacNotificationWorker({
      processEcacNotificationEventsUseCase: { executeScheduled },
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      processingTtlMs: 300_000,
    });

    const running = worker.run();
    await vi.waitFor(() => expect(executeScheduled).toHaveBeenCalledTimes(1));
    worker.stop();
    completeCycle({
      claimed: 0,
      delivered: 0,
      failed: 0,
      retryScheduled: 0,
      missing: 0,
    });
    await running;

    expect(executeScheduled).toHaveBeenCalledTimes(1);
    expect(workerLogger.info).toHaveBeenCalledWith(
      {},
      'ecac.notification_worker.stopped',
    );
  });
});
