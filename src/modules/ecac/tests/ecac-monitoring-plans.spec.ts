import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../shared/domain/app-error.js';
import type {
  EcacMonitoringPlanRepository,
  UpsertEcacMonitoringPlanInput,
} from '../application/ports/ecac-monitoring-plan-repository.js';
import {
  PauseEcacMonitoringPlanUseCase,
  ResumeEcacMonitoringPlanUseCase,
  UpsertEcacMonitoringPlanUseCase,
} from '../application/use-cases/manage-ecac-monitoring-plans.js';
import { RunEcacMonitoringUseCase } from '../application/use-cases/run-ecac-monitoring.js';
import {
  computeNextMonitoringRun,
  monitoringRequestKey,
  type ClaimedEcacMonitoringPlan,
  type EcacMonitoringPlan,
} from '../domain/ecac-monitoring-plan.js';
import type { EcacSyncBatch } from '../domain/ecac-radar.js';

const tenantId = '20000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000002';
const companyId = '20000000-0000-4000-8000-000000000003';
const powerOfAttorneyId = '20000000-0000-4000-8000-000000000004';
const planId = '20000000-0000-4000-8000-000000000005';
const batchId = '20000000-0000-4000-8000-000000000006';
const lockToken = '20000000-0000-4000-8000-000000000007';

function plan(overrides: Partial<EcacMonitoringPlan> = {}): EcacMonitoringPlan {
  const now = new Date('2026-07-27T03:00:00.000Z');
  return {
    id: planId,
    tenantId,
    companyId,
    powerOfAttorneyId,
    queryType: 'MAILBOX',
    status: 'ACTIVE',
    intervalMinutes: 1_440,
    maxAttempts: 5,
    nextRunAt: now,
    lastRunAt: null,
    lastBatchId: null,
    lastFailureAt: null,
    lastFailureCode: null,
    consecutiveFailures: 0,
    triggeredRuns: 0,
    createdById: actorId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function claimedPlan(
  overrides: Partial<ClaimedEcacMonitoringPlan> = {},
): ClaimedEcacMonitoringPlan {
  return {
    id: planId,
    lockToken,
    tenantId,
    companyId,
    powerOfAttorneyId,
    queryType: 'MAILBOX',
    intervalMinutes: 1_440,
    maxAttempts: 5,
    consecutiveFailures: 0,
    scheduledFor: new Date('2026-07-27T03:00:00.000Z'),
    createdById: actorId,
    ...overrides,
  };
}

function batch(): EcacSyncBatch {
  const now = new Date('2026-07-27T03:00:05.000Z');
  return {
    id: batchId,
    tenantId,
    requestKey: monitoringRequestKey(planId, new Date('2026-07-27T03:00:00.000Z')),
    queryType: 'MAILBOX',
    status: 'QUEUED',
    requestedById: actorId,
    totalJobs: 1,
    succeededJobs: 0,
    failedJobs: 0,
    jobs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function repository(
  overrides: Partial<EcacMonitoringPlanRepository> = {},
): EcacMonitoringPlanRepository {
  return {
    upsertWithAudit: vi.fn(async () => plan()),
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    changeStatusWithAudit: vi.fn(async () => plan()),
    deleteWithAudit: vi.fn(async () => undefined),
    claimDuePlansAcrossTenants: vi.fn(async () => []),
    recordRunWithAudit: vi.fn(async () => true),
    recordFailureWithAudit: vi.fn(async () => true),
    ...overrides,
  };
}

describe('planos de monitoramento e-CAC', () => {
  it('descarta janelas vencidas em vez de disparar consultas retroativas', () => {
    const scheduledFor = new Date('2026-07-20T03:00:00.000Z');
    const next = computeNextMonitoringRun(
      scheduledFor,
      1_440,
      new Date('2026-07-27T05:30:00.000Z'),
    );

    expect(next.toISOString()).toBe('2026-07-28T03:00:00.000Z');
  });

  it('preserva o horário escolhido quando a execução ocorre na janela', () => {
    const scheduledFor = new Date('2026-07-27T03:00:00.000Z');
    const next = computeNextMonitoringRun(
      scheduledFor,
      1_440,
      new Date('2026-07-27T03:00:12.000Z'),
    );

    expect(next.toISOString()).toBe('2026-07-28T03:00:00.000Z');
  });

  it('recusa intervalo abaixo do mínimo para não martelar o portal', async () => {
    const useCase = new UpsertEcacMonitoringPlanUseCase({
      ecacMonitoringPlanRepository: repository(),
    });

    await expect(
      useCase.execute({
        tenantId,
        actorId,
        companyId,
        powerOfAttorneyId,
        queryType: 'MAILBOX',
        intervalMinutes: 30,
      }),
    ).rejects.toThrow('intervalo');
  });

  it('normaliza data inicial no passado para a execução imediata', async () => {
    const upsertWithAudit = vi.fn(
      async (input: UpsertEcacMonitoringPlanInput) =>
        plan({ nextRunAt: input.nextRunAt }),
    );
    const useCase = new UpsertEcacMonitoringPlanUseCase({
      ecacMonitoringPlanRepository: repository({ upsertWithAudit }),
    });

    await useCase.execute({
      tenantId,
      actorId,
      companyId,
      powerOfAttorneyId,
      queryType: 'MAILBOX',
      intervalMinutes: 1_440,
      startAt: '2020-01-01T00:00:00.000Z',
    });

    const [input] = vi.mocked(upsertWithAudit).mock.calls[0]!;
    expect(input.nextRunAt.getTime()).toBeGreaterThan(
      new Date('2026-01-01T00:00:00.000Z').getTime(),
    );
  });

  it('dispara o lote com chave idempotente derivada da janela agendada', async () => {
    const execute = vi.fn(async () => batch());
    const recordRunWithAudit = vi.fn(async () => true);
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository({
        claimDuePlansAcrossTenants: vi.fn(async () => [claimedPlan()]),
        recordRunWithAudit,
      }),
      requestEcacSyncUseCase: { execute },
    });

    await expect(useCase.executeScheduled(25, 600_000)).resolves.toEqual({
      claimed: 1,
      triggered: 1,
      failed: 0,
      paused: 0,
      leaseLost: 0,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorId,
        requestKey: `monitor:${planId}:2026-07-27T03:00:00.000Z`,
        queryType: 'MAILBOX',
        maxAttempts: 5,
        targets: [{ companyId, powerOfAttorneyId }],
      }),
    );
    expect(recordRunWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ batchId, lockToken, planId }),
    );
  });

  it('não contabiliza execução quando a posse do plano foi perdida', async () => {
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository({
        claimDuePlansAcrossTenants: vi.fn(async () => [claimedPlan()]),
        recordRunWithAudit: vi.fn(async () => false),
      }),
      requestEcacSyncUseCase: { execute: vi.fn(async () => batch()) },
    });

    await expect(useCase.executeScheduled(25, 600_000)).resolves.toMatchObject({
      triggered: 0,
      leaseLost: 1,
    });
  });

  it('registra a falha e avança a agenda sem pausar na primeira ocorrência', async () => {
    const recordFailureWithAudit = vi.fn(async () => true);
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository({
        claimDuePlansAcrossTenants: vi.fn(async () => [claimedPlan()]),
        recordFailureWithAudit,
      }),
      requestEcacSyncUseCase: {
        execute: vi.fn(async () => {
          throw new ConflictError(
            'A empresa precisa de procuração e certificado válidos.',
            'ECAC_AUTHORIZATION_INVALID',
          );
        }),
      },
    });

    await expect(useCase.executeScheduled(25, 600_000)).resolves.toMatchObject({
      failed: 1,
      paused: 0,
    });
    expect(recordFailureWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'ECAC_AUTHORIZATION_INVALID',
        pause: false,
      }),
    );
  });

  it('pausa o plano depois de falhas consecutivas seguidas', async () => {
    const recordFailureWithAudit = vi.fn(async () => true);
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository({
        claimDuePlansAcrossTenants: vi.fn(async () => [
          claimedPlan({ consecutiveFailures: 4 }),
        ]),
        recordFailureWithAudit,
      }),
      requestEcacSyncUseCase: {
        execute: vi.fn(async () => {
          throw new ConflictError('Autorização inválida.', 'ECAC_AUTHORIZATION_INVALID');
        }),
      },
    });

    await expect(useCase.executeScheduled(25, 600_000)).resolves.toMatchObject({
      failed: 1,
      paused: 1,
    });
    expect(recordFailureWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ pause: true }),
    );
  });

  it('não vaza mensagem interna do provedor no código de falha', async () => {
    const recordFailureWithAudit = vi.fn(async () => true);
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository({
        claimDuePlansAcrossTenants: vi.fn(async () => [claimedPlan()]),
        recordFailureWithAudit,
      }),
      requestEcacSyncUseCase: {
        execute: vi.fn(async () => {
          throw new Error('connection string do banco');
        }),
      },
    });

    await useCase.executeScheduled(25, 600_000);
    expect(recordFailureWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'ECAC_MONITORING_UNEXPECTED_ERROR',
      }),
    );
    expect(JSON.stringify(vi.mocked(recordFailureWithAudit).mock.calls)).not.toContain(
      'connection string',
    );
  });

  it('isola uma falha de plano sem interromper os demais do ciclo', async () => {
    const otherPlanId = '20000000-0000-4000-8000-000000000009';
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError('Falha.', 'ECAC_AUTHORIZATION_INVALID'))
      .mockResolvedValueOnce(batch());
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository({
        claimDuePlansAcrossTenants: vi.fn(async () => [
          claimedPlan(),
          claimedPlan({ id: otherPlanId }),
        ]),
      }),
      requestEcacSyncUseCase: { execute },
    });

    await expect(useCase.executeScheduled(25, 600_000)).resolves.toMatchObject({
      claimed: 2,
      triggered: 1,
      failed: 1,
    });
  });

  it('exige limite e TTL de posse coerentes no agendador', async () => {
    const useCase = new RunEcacMonitoringUseCase({
      ecacMonitoringPlanRepository: repository(),
      requestEcacSyncUseCase: { execute: vi.fn(async () => batch()) },
    });

    await expect(useCase.executeScheduled(0, 600_000)).rejects.toThrow('limite');
    await expect(useCase.executeScheduled(25, 1_000)).rejects.toThrow('TTL');
  });

  it('pausa e retoma o plano pelo escritório autenticado', async () => {
    const changeStatusWithAudit = vi.fn(async () => plan({ status: 'PAUSED' }));
    const repositoryStub = repository({ changeStatusWithAudit });

    await new PauseEcacMonitoringPlanUseCase({
      ecacMonitoringPlanRepository: repositoryStub,
    }).execute(tenantId, planId, actorId);
    await new ResumeEcacMonitoringPlanUseCase({
      ecacMonitoringPlanRepository: repositoryStub,
    }).execute(tenantId, planId, actorId);

    expect(changeStatusWithAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId, planId, status: 'PAUSED', actorId }),
    );
    expect(changeStatusWithAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId, planId, status: 'ACTIVE', actorId }),
    );
  });
});
