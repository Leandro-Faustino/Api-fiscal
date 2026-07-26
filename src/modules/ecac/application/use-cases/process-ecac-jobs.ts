import { createHash } from 'node:crypto';
import type { EcacGateway } from '../ports/ecac-gateway.js';
import { EcacGatewayError } from '../ports/ecac-gateway.js';
import type { EcacRadarRepository } from '../ports/ecac-radar-repository.js';
import { ValidationError } from '../../../../shared/domain/app-error.js';

interface Dependencies {
  ecacRadarRepository: EcacRadarRepository;
  ecacGateway: EcacGateway;
}

export interface ProcessEcacJobsResult {
  claimed: number;
  succeeded: number;
  deferred: number;
  retryScheduled: number;
  failed: number;
  leaseLost: number;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return 'Falha desconhecida ao consultar o provedor e-CAC.';
}

export class ProcessEcacJobsUseCase {
  private readonly repository: EcacRadarRepository;
  private readonly gateway: EcacGateway;

  public constructor({ ecacRadarRepository, ecacGateway }: Dependencies) {
    this.repository = ecacRadarRepository;
    this.gateway = ecacGateway;
  }

  public async execute(tenantId: string, limit = 10): Promise<ProcessEcacJobsResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new ValidationError('O limite deve ser um inteiro entre 1 e 25.');
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - 10 * 60_000);
    const jobs = await this.repository.claimDueJobs(tenantId, limit, now, staleBefore);
    return this.process(jobs);
  }

  public async executeScheduled(
    limit: number,
    lockTtlMs: number,
  ): Promise<ProcessEcacJobsResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('O limite global deve ser um inteiro entre 1 e 100.');
    }
    if (!Number.isInteger(lockTtlMs) || lockTtlMs < 60_000) {
      throw new ValidationError('O TTL do lock deve ser de pelo menos 60 segundos.');
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - lockTtlMs);
    const jobs = await this.repository.claimDueJobsAcrossTenants(
      limit,
      now,
      staleBefore,
    );
    return this.process(jobs);
  }

  private async process(
    jobs: Awaited<ReturnType<EcacRadarRepository['claimDueJobs']>>,
  ): Promise<ProcessEcacJobsResult> {
    const summary: ProcessEcacJobsResult = {
      claimed: jobs.length,
      succeeded: 0,
      deferred: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
    };

    for (const job of jobs) {
      const tenantId = job.tenantId;
      if (!job.authorizationValid) {
        const status = await this.repository.failJobWithAudit({
          tenantId,
          jobId: job.id,
          lockToken: job.lockToken,
          errorCode: 'ECAC_AUTHORIZATION_INVALID',
          errorMessage: 'A procuração ou o certificado não está válido para esta consulta.',
          retriable: false,
          failedAt: new Date(),
        });
        if (status === 'LEASE_LOST') {
          summary.leaseLost += 1;
        } else {
          summary.failed += 1;
        }
        continue;
      }

      try {
        const result = await this.gateway.query({
          jobId: job.id,
          lockToken: job.lockToken,
          tenantId,
          companyId: job.companyId,
          companyCnpj: job.companyCnpj,
          powerOfAttorneyId: job.powerOfAttorneyId,
          certificateId: job.certificateId,
          queryType: job.queryType,
        });
        if (result.state === 'DEFERRED') {
          const deferred = await this.repository.deferJobWithAudit({
            tenantId,
            jobId: job.id,
            lockToken: job.lockToken,
            provider: result.provider,
            resumeAt: result.resumeAt,
            providerStatus: result.providerStatus,
            deferredAt: new Date(),
          });
          if (deferred) {
            summary.deferred += 1;
          } else {
            summary.leaseLost += 1;
          }
          continue;
        }
        const responseHash = createHash('sha256')
          .update(JSON.stringify(result.payload))
          .digest('hex');
        const completed = await this.repository.completeJobWithAudit({
          tenantId,
          jobId: job.id,
          lockToken: job.lockToken,
          provider: result.provider,
          protocol: result.protocol,
          responseHash,
          ...(result.artifactHash === undefined
            ? {}
            : { artifactHash: result.artifactHash }),
          findings: result.findings,
          completedAt: result.fetchedAt,
        });
        if (completed) {
          summary.succeeded += 1;
        } else {
          summary.leaseLost += 1;
        }
      } catch (error: unknown) {
        const gatewayError =
          error instanceof EcacGatewayError
            ? error
            : new EcacGatewayError(
                safeMessage(error),
                'ECAC_PROVIDER_UNEXPECTED_ERROR',
                true,
              );
        const status = await this.repository.failJobWithAudit({
          tenantId,
          jobId: job.id,
          lockToken: job.lockToken,
          errorCode: gatewayError.code,
          errorMessage: safeMessage(gatewayError),
          retriable: gatewayError.retriable,
          failedAt: new Date(),
        });
        if (status === 'RETRY_SCHEDULED') {
          summary.retryScheduled += 1;
        } else if (status === 'LEASE_LOST') {
          summary.leaseLost += 1;
        } else {
          summary.failed += 1;
        }
      }
    }

    return summary;
  }
}
