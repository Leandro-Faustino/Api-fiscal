import { describe, expect, it, vi } from 'vitest';
import type {
  EcacGateway,
  EcacGatewayResult,
} from '../application/ports/ecac-gateway.js';
import { EcacGatewayError } from '../application/ports/ecac-gateway.js';
import type { EcacRadarRepository } from '../application/ports/ecac-radar-repository.js';
import { ProcessEcacJobsUseCase } from '../application/use-cases/process-ecac-jobs.js';
import { RequestEcacSyncUseCase } from '../application/use-cases/request-ecac-sync.js';
import type {
  ClaimedEcacJob,
  EcacSyncBatch,
} from '../domain/ecac-radar.js';
import { fingerprintEcacFinding } from '../domain/ecac-radar.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const companyId = '10000000-0000-4000-8000-000000000003';
const powerOfAttorneyId = '10000000-0000-4000-8000-000000000004';
const certificateId = '10000000-0000-4000-8000-000000000005';

function batch(): EcacSyncBatch {
  const now = new Date('2026-07-26T03:00:00.000Z');
  return {
    id: '10000000-0000-4000-8000-000000000006',
    tenantId,
    requestKey: 'radar-2026-07-26',
    queryType: 'TAX_STATUS',
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

function claimedJob(authorizationValid = true): ClaimedEcacJob {
  return {
    id: '10000000-0000-4000-8000-000000000007',
    lockToken: '10000000-0000-4000-8000-000000000008',
    tenantId,
    batchId: '10000000-0000-4000-8000-000000000006',
    companyId,
    companyCnpj: '11222333000181',
    powerOfAttorneyId,
    certificateId,
    queryType: 'TAX_STATUS',
    attemptCount: 1,
    maxAttempts: 5,
    authorizationValid,
  };
}

function repository(overrides: Partial<EcacRadarRepository> = {}): EcacRadarRepository {
  return {
    createBatchWithAudit: vi.fn(async () => batch()),
    getBatch: vi.fn(async () => null),
    listBatches: vi.fn(async () => []),
    claimDueJobs: vi.fn(async () => []),
    claimDueJobsAcrossTenants: vi.fn(async () => []),
    completeJobWithAudit: vi.fn(async () => true),
    deferJobWithAudit: vi.fn(async () => true),
    failJobWithAudit: vi.fn(async () => 'RETRY_SCHEDULED' as const),
    listFindings: vi.fn(async () => []),
    listAlerts: vi.fn(async () => []),
    acknowledgeAlertWithAudit: vi.fn(async () => {
      throw new Error('Alerta não configurado no teste.');
    }),
    ...overrides,
  };
}

describe('Radar e-CAC', () => {
  it('gera identidade estável sem confundir alteração de conteúdo com novo achado', () => {
    const first = fingerprintEcacFinding({
      code: ' PENDING_DEBT ',
      category: 'debt',
      title: 'Débito pendente',
      description: 'Valor original',
      severity: 'WARNING',
      sourceReference: 'DEBT-001',
      observedAt: new Date('2026-07-26T03:00:00.000Z'),
    });
    const changed = fingerprintEcacFinding({
      code: 'pending_debt',
      category: 'DEBT',
      title: 'Débito pendente atualizado',
      description: 'Novo valor',
      severity: 'CRITICAL',
      sourceReference: ' debt-001 ',
      observedAt: new Date('2026-07-27T03:00:00.000Z'),
    });

    expect(changed.findingKey).toBe(first.findingKey);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it('cria lote idempotente com hash estável dos alvos', async () => {
    const createBatchWithAudit = vi.fn(async () => batch());
    const useCase = new RequestEcacSyncUseCase({
      ecacRadarRepository: repository({ createBatchWithAudit }),
    });

    const result = await useCase.execute({
      tenantId,
      actorId,
      requestKey: ' radar-2026-07-26 ',
      queryType: 'TAX_STATUS',
      targets: [{ companyId, powerOfAttorneyId }],
    });

    expect(result.status).toBe('QUEUED');
    expect(createBatchWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        requestKey: 'radar-2026-07-26',
        queryType: 'TAX_STATUS',
        targetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        maxAttempts: 5,
      }),
    );
  });

  it('rejeita alvos repetidos antes de acessar o banco', async () => {
    const createBatchWithAudit = vi.fn(async () => batch());
    const useCase = new RequestEcacSyncUseCase({
      ecacRadarRepository: repository({ createBatchWithAudit }),
    });

    await expect(
      useCase.execute({
        tenantId,
        actorId,
        requestKey: 'radar-duplicado',
        queryType: 'DEBTS',
        targets: [
          { companyId, powerOfAttorneyId },
          { companyId, powerOfAttorneyId },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(createBatchWithAudit).not.toHaveBeenCalled();
  });

  it('processa um job e persiste protocolo, hash e achados normalizados', async () => {
    const completeJobWithAudit = vi.fn(async () => true);
    const radarRepository = repository({
      claimDueJobs: vi.fn(async () => [claimedJob()]),
      completeJobWithAudit,
    });
    const gateway: EcacGateway = {
      query: vi.fn(async (): Promise<EcacGatewayResult> => ({
        state: 'COMPLETED',
        provider: 'SERPRO_INTEGRA_CONTADOR',
        protocol: 'PROTOCOLO-1',
        fetchedAt: new Date('2026-07-26T03:05:00.000Z'),
        payload: { situation: 'PENDING' },
        findings: [
          {
            code: 'DEBT_FOUND',
            category: 'DEBT',
            title: 'Débito identificado',
            severity: 'CRITICAL',
            sourceReference: 'DEBITO-1',
            observedAt: new Date('2026-07-26T03:05:00.000Z'),
          },
        ],
      })),
    };
    const useCase = new ProcessEcacJobsUseCase({
      ecacRadarRepository: radarRepository,
      ecacGateway: gateway,
    });

    const result = await useCase.execute(tenantId, 10);

    expect(result).toEqual({
      claimed: 1,
      succeeded: 1,
      deferred: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
    });
    expect(completeJobWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        provider: 'SERPRO_INTEGRA_CONTADOR',
        protocol: 'PROTOCOLO-1',
        responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        findings: [expect.objectContaining({ code: 'DEBT_FOUND' })],
      }),
    );
  });

  it('agenda nova tentativa em falha transitória do provedor', async () => {
    const failJobWithAudit = vi.fn(async () => 'RETRY_SCHEDULED' as const);
    const gateway: EcacGateway = {
      query: vi.fn(async () => {
        throw new EcacGatewayError(
          'Serviço temporariamente indisponível.',
          'ECAC_PROVIDER_TIMEOUT',
          true,
        );
      }),
    };
    const useCase = new ProcessEcacJobsUseCase({
      ecacRadarRepository: repository({
        claimDueJobs: vi.fn(async () => [claimedJob()]),
        failJobWithAudit,
      }),
      ecacGateway: gateway,
    });

    const result = await useCase.execute(tenantId, 1);

    expect(result.retryScheduled).toBe(1);
    expect(failJobWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'ECAC_PROVIDER_TIMEOUT',
        retriable: true,
      }),
    );
  });

  it('adia o job pelo tempo informado pelo provedor sem registrar falha', async () => {
    const deferJobWithAudit = vi.fn(async () => true);
    const resumeAt = new Date('2026-07-26T03:05:04.000Z');
    const gateway: EcacGateway = {
      query: vi.fn(async () => ({
        state: 'DEFERRED' as const,
        provider: 'SERPRO_INTEGRA_CONTADOR',
        resumeAt,
        providerStatus: 202,
      })),
    };
    const failJobWithAudit = vi.fn(async () => 'FAILED' as const);
    const useCase = new ProcessEcacJobsUseCase({
      ecacRadarRepository: repository({
        claimDueJobs: vi.fn(async () => [claimedJob()]),
        deferJobWithAudit,
        failJobWithAudit,
      }),
      ecacGateway: gateway,
    });

    const result = await useCase.execute(tenantId, 1);

    expect(result).toEqual({
      claimed: 1,
      succeeded: 0,
      deferred: 1,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
    });
    expect(deferJobWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        provider: 'SERPRO_INTEGRA_CONTADOR',
        resumeAt,
        providerStatus: 202,
      }),
    );
    expect(failJobWithAudit).not.toHaveBeenCalled();
  });

  it('não chama o provedor quando a autorização foi revogada após o enfileiramento', async () => {
    const failJobWithAudit = vi.fn(async () => 'FAILED' as const);
    const gateway: EcacGateway = {
      query: vi.fn(),
    };
    const useCase = new ProcessEcacJobsUseCase({
      ecacRadarRepository: repository({
        claimDueJobs: vi.fn(async () => [claimedJob(false)]),
        failJobWithAudit,
      }),
      ecacGateway: gateway,
    });

    const result = await useCase.execute(tenantId, 1);

    expect(result.failed).toBe(1);
    expect(gateway.query).not.toHaveBeenCalled();
    expect(failJobWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'ECAC_AUTHORIZATION_INVALID',
        retriable: false,
      }),
    );
  });

  it('processa globalmente jobs de escritórios diferentes no worker', async () => {
    const otherTenantId = '20000000-0000-4000-8000-000000000001';
    const completeJobWithAudit = vi.fn(async () => true);
    const claimDueJobsAcrossTenants = vi.fn(async () => [
      { ...claimedJob(), tenantId: otherTenantId },
    ]);
    const gateway: EcacGateway = {
      query: vi.fn(async () => ({
        state: 'COMPLETED' as const,
        provider: 'SERPRO_INTEGRA_CONTADOR',
        protocol: null,
        fetchedAt: new Date('2026-07-26T03:05:00.000Z'),
        payload: { indicator: 0 },
        findings: [],
      })),
    };
    const useCase = new ProcessEcacJobsUseCase({
      ecacRadarRepository: repository({
        claimDueJobsAcrossTenants,
        completeJobWithAudit,
      }),
      ecacGateway: gateway,
    });

    const result = await useCase.executeScheduled(50, 600_000);

    expect(result.succeeded).toBe(1);
    expect(claimDueJobsAcrossTenants).toHaveBeenCalledWith(
      50,
      expect.any(Date),
      expect.any(Date),
    );
    expect(completeJobWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: otherTenantId }),
    );
  });

  it('descarta uma conclusão atrasada quando a posse do lock mudou', async () => {
    const useCase = new ProcessEcacJobsUseCase({
      ecacRadarRepository: repository({
        claimDueJobsAcrossTenants: vi.fn(async () => [claimedJob()]),
        completeJobWithAudit: vi.fn(async () => false),
      }),
      ecacGateway: {
        query: vi.fn(async () => ({
          state: 'COMPLETED' as const,
          provider: 'SERPRO_INTEGRA_CONTADOR',
          protocol: null,
          fetchedAt: new Date(),
          payload: {},
          findings: [],
        })),
      },
    });

    await expect(useCase.executeScheduled(25, 600_000)).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      deferred: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 1,
    });
  });
});
