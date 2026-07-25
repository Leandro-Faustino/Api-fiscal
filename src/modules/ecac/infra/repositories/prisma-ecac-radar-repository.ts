import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type EcacSyncBatchStatus as PrismaEcacSyncBatchStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
} from '../../../../shared/domain/app-error.js';
import type {
  CompleteEcacJobInput,
  CreateEcacBatchInput,
  EcacRadarRepository,
  FailEcacJobInput,
} from '../../application/ports/ecac-radar-repository.js';
import type {
  ClaimedEcacJob,
  EcacFinding,
  EcacFindingSeverity,
  EcacQueryType,
  EcacSyncBatch,
  EcacSyncBatchStatus,
} from '../../domain/ecac-radar.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

const batchInclude = {
  jobs: {
    include: {
      company: { select: { cnpj: true } },
      findings: { orderBy: { observedAt: 'desc' as const } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

type BatchRow = Prisma.EcacSyncBatchGetPayload<{ include: typeof batchInclude }>;
type FindingRow = Prisma.EcacFindingGetPayload<Record<string, never>>;

function toFinding(row: FindingRow): EcacFinding {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    jobId: row.jobId,
    code: row.code,
    category: row.category,
    title: row.title,
    description: row.description,
    severity: row.severity,
    sourceReference: row.sourceReference,
    observedAt: row.observedAt,
    createdAt: row.createdAt,
  };
}

function toBatch(row: BatchRow): EcacSyncBatch {
  return {
    id: row.id,
    tenantId: row.tenantId,
    requestKey: row.requestKey,
    queryType: row.queryType,
    status: row.status,
    requestedById: row.requestedById,
    totalJobs: row.totalJobs,
    succeededJobs: row.succeededJobs,
    failedJobs: row.failedJobs,
    jobs: row.jobs.map((job) => ({
      id: job.id,
      tenantId: job.tenantId,
      batchId: job.batchId,
      companyId: job.companyId,
      companyCnpj: job.company.cnpj,
      powerOfAttorneyId: job.powerOfAttorneyId,
      certificateId: job.certificateId,
      queryType: job.queryType,
      status: job.status,
      provider: job.provider,
      protocol: job.protocol,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: job.nextAttemptAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      findings: job.findings.map(toFinding),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serviceAllowsQuery(services: string[], queryType: EcacQueryType): boolean {
  const normalized = new Set(services.map((service) => service.trim().toUpperCase()));
  return (
    normalized.has('ECAC') ||
    normalized.has('INTEGRA_CONTADOR') ||
    normalized.has(queryType)
  );
}

export class PrismaEcacRadarRepository implements EcacRadarRepository {
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async createBatchWithAudit(input: CreateEcacBatchInput): Promise<EcacSyncBatch> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.ecacSyncBatch.findUnique({
        where: {
          tenantId_requestKey: {
            tenantId: input.tenantId,
            requestKey: input.requestKey,
          },
        },
        include: batchInclude,
      });
      if (existing) {
        if (existing.targetHash !== input.targetHash || existing.queryType !== input.queryType) {
          throw new ConflictError(
            'A chave idempotente já foi usada com outro conteúdo.',
            'ECAC_IDEMPOTENCY_KEY_REUSED',
          );
        }
        return toBatch(existing);
      }

      const actorMembership = await transaction.membership.count({
        where: {
          tenantId: input.tenantId,
          userId: input.requestedById,
          status: 'ACTIVE',
        },
      });
      if (actorMembership !== 1) {
        throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
      }

      const authorityIds = input.targets.map((target) => target.powerOfAttorneyId);
      const authorities = await transaction.powerOfAttorney.findMany({
        where: {
          tenantId: input.tenantId,
          id: { in: authorityIds },
        },
        include: {
          certificate: {
            include: {
              companyScopes: { select: { companyId: true } },
            },
          },
        },
      });
      const byId = new Map(authorities.map((authority) => [authority.id, authority]));

      const jobs = input.targets.map((target) => {
        const authority = byId.get(target.powerOfAttorneyId);
        const certificate = authority?.certificate;
        const hasCompanyScope =
          certificate?.companyScopes.some((scope) => scope.companyId === target.companyId) ??
          false;
        const valid =
          authority?.companyId === target.companyId &&
          authority.status === 'ACTIVE' &&
          authority.validFrom <= input.now &&
          authority.validUntil >= input.now &&
          serviceAllowsQuery(authority.services, input.queryType) &&
          certificate?.status === 'ACTIVE' &&
          certificate.validFrom <= input.now &&
          certificate.validUntil >= input.now &&
          hasCompanyScope;

        if (!valid || !authority || !certificate) {
          throw new ConflictError(
            'A empresa precisa de procuração e certificado válidos para a consulta solicitada.',
            'ECAC_AUTHORIZATION_INVALID',
          );
        }

        return {
          tenantId: input.tenantId,
          batchId: input.id,
          companyId: target.companyId,
          powerOfAttorneyId: authority.id,
          certificateId: certificate.id,
          queryType: input.queryType,
          maxAttempts: input.maxAttempts,
          nextAttemptAt: input.now,
        };
      });

      await transaction.ecacSyncBatch.create({
        data: {
          id: input.id,
          tenantId: input.tenantId,
          requestKey: input.requestKey,
          targetHash: input.targetHash,
          queryType: input.queryType,
          requestedById: input.requestedById,
          totalJobs: jobs.length,
        },
      });
      await transaction.ecacSyncJob.createMany({ data: jobs });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.requestedById,
          action: 'ecac.sync.requested',
          entityType: 'ecac_sync_batch',
          entityId: input.id,
          metadata: {
            requestKey: input.requestKey,
            queryType: input.queryType,
            totalJobs: jobs.length,
          },
        },
      });

      const created = await transaction.ecacSyncBatch.findUniqueOrThrow({
        where: { id: input.id },
        include: batchInclude,
      });
        return toBatch(created);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.ecacSyncBatch.findUnique({
          where: {
            tenantId_requestKey: {
              tenantId: input.tenantId,
              requestKey: input.requestKey,
            },
          },
          include: batchInclude,
        });
        if (
          existing &&
          existing.targetHash === input.targetHash &&
          existing.queryType === input.queryType
        ) {
          return toBatch(existing);
        }
        throw new ConflictError(
          'A chave idempotente já foi usada com outro conteúdo.',
          'ECAC_IDEMPOTENCY_KEY_REUSED',
        );
      }
      throw error;
    }
  }

  public async getBatch(tenantId: string, batchId: string): Promise<EcacSyncBatch | null> {
    const row = await this.prisma.ecacSyncBatch.findUnique({
      where: { tenantId_id: { tenantId, id: batchId } },
      include: batchInclude,
    });
    return row ? toBatch(row) : null;
  }

  public async listBatches(
    tenantId: string,
    status?: EcacSyncBatchStatus,
    companyId?: string,
  ): Promise<EcacSyncBatch[]> {
    const rows = await this.prisma.ecacSyncBatch.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(companyId ? { jobs: { some: { companyId } } } : {}),
      },
      include: batchInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toBatch);
  }

  public async claimDueJobs(
    tenantId: string,
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<ClaimedEcacJob[]> {
    const candidates = await this.prisma.ecacSyncJob.findMany({
      where: {
        tenantId,
        OR: [
          {
            status: { in: ['QUEUED', 'RETRY_SCHEDULED'] },
            nextAttemptAt: { lte: now },
          },
          {
            status: 'PROCESSING',
            lockedAt: { lt: staleBefore },
          },
        ],
      },
      select: { id: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    const claimedIds: string[] = [];
    for (const candidate of candidates) {
      const claimed = await this.prisma.ecacSyncJob.updateMany({
        where: {
          id: candidate.id,
          tenantId,
          OR: [
            {
              status: { in: ['QUEUED', 'RETRY_SCHEDULED'] },
              nextAttemptAt: { lte: now },
            },
            {
              status: 'PROCESSING',
              lockedAt: { lt: staleBefore },
            },
          ],
        },
        data: {
          status: 'PROCESSING',
          lockedAt: now,
          startedAt: now,
          attemptCount: { increment: 1 },
          errorCode: null,
          errorMessage: null,
        },
      });
      if (claimed.count === 1) {
        claimedIds.push(candidate.id);
      }
    }

    if (claimedIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.ecacSyncJob.findMany({
      where: { tenantId, id: { in: claimedIds } },
      include: {
        company: { select: { cnpj: true } },
        powerOfAttorney: true,
        certificate: {
          include: {
            companyScopes: { select: { companyId: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    await this.prisma.ecacSyncBatch.updateMany({
      where: {
        tenantId,
        id: { in: [...new Set(rows.map((row) => row.batchId))] },
        status: 'QUEUED',
      },
      data: { status: 'RUNNING' },
    });

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      batchId: row.batchId,
      companyId: row.companyId,
      companyCnpj: row.company.cnpj,
      powerOfAttorneyId: row.powerOfAttorneyId,
      certificateId: row.certificateId,
      queryType: row.queryType,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      authorizationValid:
        row.powerOfAttorney.status === 'ACTIVE' &&
        row.powerOfAttorney.validFrom <= now &&
        row.powerOfAttorney.validUntil >= now &&
        row.powerOfAttorney.companyId === row.companyId &&
        row.powerOfAttorney.certificateId === row.certificateId &&
        serviceAllowsQuery(row.powerOfAttorney.services, row.queryType) &&
        row.certificate.status === 'ACTIVE' &&
        row.certificate.validFrom <= now &&
        row.certificate.validUntil >= now &&
        row.certificate.companyScopes.some((scope) => scope.companyId === row.companyId),
    }));
  }

  public async completeJobWithAudit(input: CompleteEcacJobInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.ecacSyncJob.findFirst({
        where: { id: input.jobId, tenantId: input.tenantId, status: 'PROCESSING' },
      });
      if (!job) {
        throw new NotFoundError('Job e-CAC não encontrado.', 'ECAC_JOB_NOT_FOUND');
      }

      if (input.findings.length > 0) {
        await transaction.ecacFinding.createMany({
          data: input.findings.map((finding) => ({
            id: randomUUID(),
            tenantId: input.tenantId,
            companyId: job.companyId,
            jobId: job.id,
            code: finding.code,
            category: finding.category,
            title: finding.title,
            description: finding.description ?? null,
            severity: finding.severity,
            sourceReference: finding.sourceReference ?? null,
            observedAt: finding.observedAt,
          })),
          skipDuplicates: true,
        });
      }

      await transaction.ecacSyncJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          provider: input.provider,
          protocol: input.protocol,
          responseHash: input.responseHash,
          completedAt: input.completedAt,
          lockedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          action: 'ecac.sync.succeeded',
          entityType: 'ecac_sync_job',
          entityId: job.id,
          metadata: {
            batchId: job.batchId,
            companyId: job.companyId,
            provider: input.provider,
            protocol: input.protocol,
            findingCount: input.findings.length,
            responseHash: input.responseHash,
          },
        },
      });
      await this.updateBatchStatus(transaction, input.tenantId, job.batchId);
    });
  }

  public async failJobWithAudit(
    input: FailEcacJobInput,
  ): Promise<'RETRY_SCHEDULED' | 'FAILED'> {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.ecacSyncJob.findFirst({
        where: { id: input.jobId, tenantId: input.tenantId, status: 'PROCESSING' },
      });
      if (!job) {
        throw new NotFoundError('Job e-CAC não encontrado.', 'ECAC_JOB_NOT_FOUND');
      }

      const retry = input.retriable && job.attemptCount < job.maxAttempts;
      const status = retry ? 'RETRY_SCHEDULED' : 'FAILED';
      const delaySeconds = Math.min(3_600, 30 * 2 ** Math.max(0, job.attemptCount - 1));
      await transaction.ecacSyncJob.update({
        where: { id: job.id },
        data: {
          status,
          nextAttemptAt: retry
            ? new Date(input.failedAt.getTime() + delaySeconds * 1_000)
            : input.failedAt,
          completedAt: retry ? null : input.failedAt,
          lockedAt: null,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage.slice(0, 500),
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          action: retry ? 'ecac.sync.retry_scheduled' : 'ecac.sync.failed',
          entityType: 'ecac_sync_job',
          entityId: job.id,
          metadata: {
            batchId: job.batchId,
            companyId: job.companyId,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            errorCode: input.errorCode,
          },
        },
      });
      await this.updateBatchStatus(transaction, input.tenantId, job.batchId);
      return status;
    });
  }

  public async listFindings(
    tenantId: string,
    companyId?: string,
    severity?: EcacFindingSeverity,
  ): Promise<EcacFinding[]> {
    const rows = await this.prisma.ecacFinding.findMany({
      where: {
        tenantId,
        ...(companyId ? { companyId } : {}),
        ...(severity ? { severity } : {}),
      },
      orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(toFinding);
  }

  private async updateBatchStatus(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    batchId: string,
  ): Promise<void> {
    const [totalJobs, succeededJobs, failedJobs, activeJobs] = await Promise.all([
      transaction.ecacSyncJob.count({ where: { tenantId, batchId } }),
      transaction.ecacSyncJob.count({ where: { tenantId, batchId, status: 'SUCCEEDED' } }),
      transaction.ecacSyncJob.count({ where: { tenantId, batchId, status: 'FAILED' } }),
      transaction.ecacSyncJob.count({
        where: {
          tenantId,
          batchId,
          status: { in: ['QUEUED', 'PROCESSING', 'RETRY_SCHEDULED'] },
        },
      }),
    ]);

    let status: PrismaEcacSyncBatchStatus = 'RUNNING';
    if (activeJobs === 0) {
      if (succeededJobs === totalJobs) {
        status = 'SUCCEEDED';
      } else if (failedJobs === totalJobs) {
        status = 'FAILED';
      } else {
        status = 'PARTIAL';
      }
    }

    await transaction.ecacSyncBatch.update({
      where: { tenantId_id: { tenantId, id: batchId } },
      data: { status, totalJobs, succeededJobs, failedJobs },
    });
  }
}
