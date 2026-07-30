import { createHash, randomUUID } from 'node:crypto';
import {
  Prisma,
  type EcacAlert as PrismaEcacAlert,
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
  DeferEcacJobInput,
  EcacRadarRepository,
  FailEcacJobInput,
  ListEcacAlertsFilter,
} from '../../application/ports/ecac-radar-repository.js';
import type {
  ClaimedEcacJob,
  EcacAlert,
  EcacAlertChangeType,
  EcacFinding,
  EcacFindingSeverity,
  EcacQueryType,
  EcacSyncBatch,
  EcacSyncBatchStatus,
} from '../../domain/ecac-radar.js';
import { fingerprintEcacFinding } from '../../domain/ecac-radar.js';

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

function toAlert(row: PrismaEcacAlert): EcacAlert {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    latestJobId: row.latestJobId,
    queryType: row.queryType,
    findingKey: row.findingKey,
    code: row.code,
    category: row.category,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    lastChangeType: row.lastChangeType,
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedById: row.acknowledgedById,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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

const severityRank: Record<EcacFindingSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

function notificationDedupeKey(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export async function acquireEcacStreamLock(
  transaction: Prisma.TransactionClient,
  streamLock: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ lockAcquired: number }>>`
    WITH acquired AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${streamLock}, 0))
    )
    SELECT 1::integer AS "lockAcquired"
    FROM acquired
  `;
  if (rows[0]?.lockAcquired !== 1) {
    throw new Error('Não foi possível adquirir o lock transacional do Radar e-CAC.');
  }
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
    return this.claimMatchingDueJobs(tenantId, limit, now, staleBefore);
  }

  public async claimDueJobsAcrossTenants(
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<ClaimedEcacJob[]> {
    return this.claimMatchingDueJobs(undefined, limit, now, staleBefore);
  }

  private async claimMatchingDueJobs(
    tenantId: string | undefined,
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<ClaimedEcacJob[]> {
    const candidates = await this.prisma.ecacSyncJob.findMany({
      where: {
        ...(tenantId === undefined ? {} : { tenantId }),
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
      select: { id: true, tenantId: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    const claimedJobs: Array<{ id: string; tenantId: string; lockToken: string }> = [];
    for (const candidate of candidates) {
      const lockToken = randomUUID();
      const claimed = await this.prisma.ecacSyncJob.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
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
          lockToken,
          startedAt: now,
          attemptCount: { increment: 1 },
          errorCode: null,
          errorMessage: null,
        },
      });
      if (claimed.count === 1) {
        claimedJobs.push({ ...candidate, lockToken });
      }
    }

    if (claimedJobs.length === 0) {
      return [];
    }

    const rows = await this.prisma.ecacSyncJob.findMany({
      where: {
        OR: claimedJobs.map((job) => ({
          id: job.id,
          tenantId: job.tenantId,
        })),
      },
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

    const batchIdsByTenant = new Map<string, Set<string>>();
    for (const row of rows) {
      const batchIds = batchIdsByTenant.get(row.tenantId) ?? new Set<string>();
      batchIds.add(row.batchId);
      batchIdsByTenant.set(row.tenantId, batchIds);
    }
    for (const [rowTenantId, batchIds] of batchIdsByTenant) {
      await this.prisma.ecacSyncBatch.updateMany({
        where: {
          tenantId: rowTenantId,
          id: { in: [...batchIds] },
          status: 'QUEUED',
        },
        data: { status: 'RUNNING' },
      });
    }

    const claimedTokens = new Map(
      claimedJobs.map((job) => [`${job.tenantId}:${job.id}`, job.lockToken]),
    );
    return rows.flatMap((row) => {
      const expectedToken = claimedTokens.get(`${row.tenantId}:${row.id}`);
      if (row.lockToken === null || row.lockToken !== expectedToken) {
        return [];
      }
      return [
        {
          id: row.id,
          lockToken: row.lockToken,
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
            row.certificate.companyScopes.some(
              (scope) => scope.companyId === row.companyId,
            ),
        },
      ];
    });
  }

  public async completeJobWithAudit(input: CompleteEcacJobInput): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.ecacSyncJob.findFirst({
        where: {
          id: input.jobId,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
      });
      if (!job) {
        return false;
      }

      const completedJob = await transaction.ecacSyncJob.updateMany({
        where: {
          id: job.id,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
        data: {
          status: 'SUCCEEDED',
          provider: input.provider,
          protocol: input.protocol,
          responseHash: input.responseHash,
          completedAt: input.completedAt,
          lockedAt: null,
          lockToken: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (completedJob.count !== 1) {
        return false;
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

      const alertChanges = await this.reconcileAlerts(
        transaction,
        job,
        input.findings,
        input.completedAt,
      );

      if (input.artifactHash) {
        const completedProcess = await transaction.ecacSitfisProcess.updateMany({
          where: {
            tenantId: input.tenantId,
            jobId: job.id,
            status: 'AWAITING_REPORT',
          },
          data: {
            status: 'COMPLETED',
            encryptedProtocol: null,
            protocolKeyVersion: null,
            nextAttemptAt: null,
            reportHash: input.artifactHash,
            completedAt: input.completedAt,
          },
        });
        if (completedProcess.count !== 1) {
          throw new NotFoundError(
            'Checkpoint SITFIS não encontrado.',
            'ECAC_SITFIS_CHECKPOINT_NOT_FOUND',
          );
        }
      }
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
            alertChanges,
            ...(input.artifactHash
              ? { artifactHash: input.artifactHash }
              : {}),
          },
        },
      });
      await this.updateBatchStatus(transaction, input.tenantId, job.batchId);
      return true;
    });
  }

  public async deferJobWithAudit(input: DeferEcacJobInput): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.ecacSyncJob.findFirst({
        where: {
          id: input.jobId,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
      });
      if (!job) {
        return false;
      }

      const deferredJob = await transaction.ecacSyncJob.updateMany({
        where: {
          id: job.id,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
        data: {
          status: 'RETRY_SCHEDULED',
          provider: input.provider,
          attemptCount: { decrement: 1 },
          nextAttemptAt: input.resumeAt,
          lockedAt: null,
          lockToken: null,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (deferredJob.count !== 1) {
        return false;
      }
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: null,
          action: 'ecac.sync.provider_wait_scheduled',
          entityType: 'ecac_sync_job',
          entityId: job.id,
          metadata: {
            batchId: job.batchId,
            companyId: job.companyId,
            provider: input.provider,
            providerStatus: input.providerStatus,
            resumeAt: input.resumeAt.toISOString(),
            deferredAt: input.deferredAt.toISOString(),
          },
        },
      });
      await this.updateBatchStatus(transaction, input.tenantId, job.batchId);
      return true;
    });
  }

  public async failJobWithAudit(
    input: FailEcacJobInput,
  ): Promise<'RETRY_SCHEDULED' | 'FAILED' | 'LEASE_LOST'> {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.ecacSyncJob.findFirst({
        where: {
          id: input.jobId,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
      });
      if (!job) {
        return 'LEASE_LOST';
      }

      const retry = input.retriable && job.attemptCount < job.maxAttempts;
      const status = retry ? 'RETRY_SCHEDULED' : 'FAILED';
      const delaySeconds = Math.min(3_600, 30 * 2 ** Math.max(0, job.attemptCount - 1));
      const failedJob = await transaction.ecacSyncJob.updateMany({
        where: {
          id: job.id,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
        data: {
          status,
          nextAttemptAt: retry
            ? new Date(input.failedAt.getTime() + delaySeconds * 1_000)
            : input.failedAt,
          completedAt: retry ? null : input.failedAt,
          lockedAt: null,
          lockToken: null,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage.slice(0, 500),
        },
      });
      if (failedJob.count !== 1) {
        return 'LEASE_LOST';
      }
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

  public async listAlerts(
    tenantId: string,
    filter: ListEcacAlertsFilter = {},
  ): Promise<EcacAlert[]> {
    const rows = await this.prisma.ecacAlert.findMany({
      where: {
        tenantId,
        ...(filter.companyId ? { companyId: filter.companyId } : {}),
        ...(filter.queryType ? { queryType: filter.queryType } : {}),
        ...(filter.severity ? { severity: filter.severity } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { severity: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: 500,
    });
    return rows.map(toAlert);
  }

  public async acknowledgeAlertWithAudit(
    tenantId: string,
    alertId: string,
    actorId: string,
    acknowledgedAt: Date,
  ): Promise<EcacAlert> {
    return this.prisma.$transaction(async (transaction) => {
      const [alert, actorMembership] = await Promise.all([
        transaction.ecacAlert.findUnique({
          where: { tenantId_id: { tenantId, id: alertId } },
        }),
        transaction.membership.count({
          where: { tenantId, userId: actorId, status: 'ACTIVE' },
        }),
      ]);
      if (!alert) {
        throw new NotFoundError('Alerta e-CAC não encontrado.', 'ECAC_ALERT_NOT_FOUND');
      }
      if (actorMembership !== 1) {
        throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
      }
      if (alert.status === 'RESOLVED') {
        throw new ConflictError(
          'Um alerta resolvido não pode ser reconhecido.',
          'ECAC_ALERT_ALREADY_RESOLVED',
        );
      }
      if (alert.status === 'ACKNOWLEDGED') {
        return toAlert(alert);
      }

      const acknowledged = await transaction.ecacAlert.update({
        where: { tenantId_id: { tenantId, id: alertId } },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt,
          acknowledgedById: actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: 'ecac.alert.acknowledged',
          entityType: 'ecac_alert',
          entityId: alertId,
          metadata: {
            companyId: alert.companyId,
            queryType: alert.queryType,
            severity: alert.severity,
          },
        },
      });
      return toAlert(acknowledged);
    });
  }

  private async reconcileAlerts(
    transaction: Prisma.TransactionClient,
    job: {
      id: string;
      tenantId: string;
      companyId: string;
      queryType: EcacQueryType;
      observationOrder: bigint;
    },
    findings: CompleteEcacJobInput['findings'],
    completedAt: Date,
  ): Promise<{
    created: number;
    changed: number;
    reopened: number;
    resolved: number;
    unchanged: number;
    staleObservation: boolean;
  }> {
    const summary = {
      created: 0,
      changed: 0,
      reopened: 0,
      resolved: 0,
      unchanged: 0,
      staleObservation: false,
    };
    const streamLock = `${job.tenantId}:${job.companyId}:${job.queryType}`;
    await acquireEcacStreamLock(transaction, streamLock);

    const cursor = await transaction.ecacObservationCursor.findUnique({
      where: {
        tenantId_companyId_queryType: {
          tenantId: job.tenantId,
          companyId: job.companyId,
          queryType: job.queryType,
        },
      },
    });
    if (cursor && cursor.latestObservationOrder >= job.observationOrder) {
      summary.staleObservation = true;
      return summary;
    }

    const fingerprinted = new Map(
      findings.map((finding) => {
        const value = fingerprintEcacFinding(finding);
        return [value.findingKey, value] as const;
      }),
    );
    const existing = await transaction.ecacAlert.findMany({
      where: {
        tenantId: job.tenantId,
        companyId: job.companyId,
        queryType: job.queryType,
      },
    });
    const existingByKey = new Map(existing.map((alert) => [alert.findingKey, alert]));

    for (const finding of fingerprinted.values()) {
      const alert = existingByKey.get(finding.findingKey);
      const commonData = {
        latestJobId: job.id,
        contentHash: finding.contentHash,
        code: finding.code,
        category: finding.category,
        title: finding.title,
        description: finding.description ?? null,
        severity: finding.severity,
        lastObservedAt: completedAt,
      };
      if (!alert) {
        const createdAlert = await transaction.ecacAlert.create({
          data: {
            id: randomUUID(),
            tenantId: job.tenantId,
            companyId: job.companyId,
            queryType: job.queryType,
            findingKey: finding.findingKey,
            ...commonData,
            status: 'OPEN',
            lastChangeType: 'NEW',
            firstObservedAt: completedAt,
          },
        });
        await this.queueAlertNotifications(
          transaction,
          createdAlert,
          'NEW',
          job.id,
          completedAt,
        );
        summary.created += 1;
        continue;
      }

      if (alert.status === 'RESOLVED') {
        const reopenedAlert = await transaction.ecacAlert.update({
          where: { tenantId_id: { tenantId: job.tenantId, id: alert.id } },
          data: {
            ...commonData,
            status: 'OPEN',
            lastChangeType: 'REOPENED',
            acknowledgedAt: null,
            acknowledgedById: null,
            resolvedAt: null,
          },
        });
        await this.queueAlertNotifications(
          transaction,
          reopenedAlert,
          'REOPENED',
          job.id,
          completedAt,
        );
        summary.reopened += 1;
      } else if (alert.contentHash !== finding.contentHash) {
        const changedAlert = await transaction.ecacAlert.update({
          where: { tenantId_id: { tenantId: job.tenantId, id: alert.id } },
          data: {
            ...commonData,
            status: 'OPEN',
            lastChangeType: 'CHANGED',
            acknowledgedAt: null,
            acknowledgedById: null,
            resolvedAt: null,
          },
        });
        await this.queueAlertNotifications(
          transaction,
          changedAlert,
          'CHANGED',
          job.id,
          completedAt,
        );
        summary.changed += 1;
      } else {
        await transaction.ecacAlert.update({
          where: { tenantId_id: { tenantId: job.tenantId, id: alert.id } },
          data: commonData,
        });
        summary.unchanged += 1;
      }
    }

    const currentKeys = [...fingerprinted.keys()];
    const alertsToResolve = await transaction.ecacAlert.findMany({
      where: {
        tenantId: job.tenantId,
        companyId: job.companyId,
        queryType: job.queryType,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        ...(currentKeys.length > 0
          ? { findingKey: { notIn: currentKeys } }
          : {}),
      },
    });
    const resolved = await transaction.ecacAlert.updateMany({
      where: {
        tenantId: job.tenantId,
        companyId: job.companyId,
        queryType: job.queryType,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        ...(currentKeys.length > 0
          ? { findingKey: { notIn: currentKeys } }
          : {}),
      },
      data: {
        latestJobId: job.id,
        status: 'RESOLVED',
        lastChangeType: 'RESOLVED',
        resolvedAt: completedAt,
      },
    });
    summary.resolved = resolved.count;
    for (const alert of alertsToResolve) {
      await this.queueAlertNotifications(
        transaction,
        { ...alert, latestJobId: job.id },
        'RESOLVED',
        job.id,
        completedAt,
      );
    }

    await transaction.ecacObservationCursor.upsert({
      where: {
        tenantId_companyId_queryType: {
          tenantId: job.tenantId,
          companyId: job.companyId,
          queryType: job.queryType,
        },
      },
      create: {
        tenantId: job.tenantId,
        companyId: job.companyId,
        queryType: job.queryType,
        latestJobId: job.id,
        latestObservationOrder: job.observationOrder,
        lastObservedAt: completedAt,
      },
      update: {
        latestJobId: job.id,
        latestObservationOrder: job.observationOrder,
        lastObservedAt: completedAt,
      },
    });
    return summary;
  }

  private async queueAlertNotifications(
    transaction: Prisma.TransactionClient,
    alert: {
      id: string;
      tenantId: string;
      companyId: string;
      latestJobId: string;
      queryType: EcacQueryType;
      title: string;
      severity: EcacFindingSeverity;
    },
    changeType: EcacAlertChangeType,
    jobId: string,
    scheduledAt: Date,
  ): Promise<void> {
    const preferences = await transaction.ecacAlertNotificationPreference.findMany({
      where: {
        tenantId: alert.tenantId,
        enabled: true,
        ...(changeType === 'RESOLVED' ? { includeResolved: true } : {}),
        user: {
          memberships: {
            some: {
              tenantId: alert.tenantId,
              status: 'ACTIVE',
            },
          },
        },
      },
    });
    const events = preferences
      .filter(
        (preference) =>
          severityRank[alert.severity] >= severityRank[preference.minimumSeverity],
      )
      .map((preference) => ({
        id: randomUUID(),
        tenantId: alert.tenantId,
        alertId: alert.id,
        userId: preference.userId,
        companyId: alert.companyId,
        queryType: alert.queryType,
        channel: preference.channel,
        status: 'PENDING' as const,
        changeType,
        severity: alert.severity,
        title: alert.title,
        dedupeKey: notificationDedupeKey([
          alert.id,
          preference.userId,
          preference.channel,
          changeType,
          jobId,
        ]),
        scheduledAt,
      }));
    if (events.length > 0) {
      await transaction.ecacAlertNotificationEvent.createMany({
        data: events,
        skipDuplicates: true,
      });
    }
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
