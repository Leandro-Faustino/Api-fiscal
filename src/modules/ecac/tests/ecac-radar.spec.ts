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
    completeJobWithAudit: vi.fn(async () => undefined),
    failJobWithAudit: vi.fn(async () => 'RETRY_SCHEDULED' as const),
    listFindings: vi.fn(async () => []),
    ...overrides,
  };
}

describe('Radar e-CAC', () => {
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
    const completeJobWithAudit = vi.fn(async () => undefined);
    const radarRepository = repository({
      claimDueJobs: vi.fn(async () => [claimedJob()]),
      completeJobWithAudit,
    });
    const gateway: EcacGateway = {
      query: vi.fn(async (): Promise<EcacGatewayResult> => ({
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
      retryScheduled: 0,
      failed: 0,
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
});
