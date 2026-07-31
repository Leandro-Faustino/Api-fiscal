import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type EcacMonitoringPlan as PrismaEcacMonitoringPlan,
  type PrismaClient,
} from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
} from '../../../../shared/domain/app-error.js';
import type {
  ChangeEcacMonitoringPlanStatusInput,
  ClaimEcacMonitoringPlansInput,
  EcacMonitoringPlanRepository,
  ListEcacMonitoringPlansFilter,
  RecordEcacMonitoringFailureInput,
  RecordEcacMonitoringRunInput,
  UpsertEcacMonitoringPlanInput,
} from '../../application/ports/ecac-monitoring-plan-repository.js';
import type {
  ClaimedEcacMonitoringPlan,
  EcacMonitoringPlan,
} from '../../domain/ecac-monitoring-plan.js';
import { powerOfAttorneyAllowsQuery } from '../../domain/ecac-radar.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

function toPlan(row: PrismaEcacMonitoringPlan): EcacMonitoringPlan {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    powerOfAttorneyId: row.powerOfAttorneyId,
    queryType: row.queryType,
    status: row.status,
    intervalMinutes: row.intervalMinutes,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastBatchId: row.lastBatchId,
    lastFailureAt: row.lastFailureAt,
    lastFailureCode: row.lastFailureCode,
    consecutiveFailures: row.consecutiveFailures,
    triggeredRuns: row.triggeredRuns,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaEcacMonitoringPlanRepository
  implements EcacMonitoringPlanRepository
{
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async upsertWithAudit(
    input: UpsertEcacMonitoringPlanInput,
  ): Promise<EcacMonitoringPlan> {
    return this.prisma.$transaction(async (transaction) => {
      const authority = await transaction.powerOfAttorney.findFirst({
        where: {
          tenantId: input.tenantId,
          id: input.powerOfAttorneyId,
          companyId: input.companyId,
        },
        include: {
          certificate: {
            include: { companyScopes: { select: { companyId: true } } },
          },
        },
      });
      const certificate = authority?.certificate;
      const authorized =
        authority !== null &&
        authority.status === 'ACTIVE' &&
        authority.validFrom <= input.now &&
        authority.validUntil >= input.now &&
        powerOfAttorneyAllowsQuery(authority.services, input.queryType) &&
        certificate?.status === 'ACTIVE' &&
        certificate.validFrom <= input.now &&
        certificate.validUntil >= input.now &&
        certificate.companyScopes.some(
          (scope) => scope.companyId === input.companyId,
        );
      if (!authorized) {
        throw new ConflictError(
          'A empresa precisa de procuração e certificado válidos para monitorar esta consulta.',
          'ECAC_AUTHORIZATION_INVALID',
        );
      }

      const existing = await transaction.ecacMonitoringPlan.findUnique({
        where: {
          tenantId_companyId_queryType: {
            tenantId: input.tenantId,
            companyId: input.companyId,
            queryType: input.queryType,
          },
        },
      });

      const plan = existing
        ? await transaction.ecacMonitoringPlan.update({
            where: { tenantId_id: { tenantId: input.tenantId, id: existing.id } },
            data: {
              powerOfAttorneyId: input.powerOfAttorneyId,
              intervalMinutes: input.intervalMinutes,
              maxAttempts: input.maxAttempts,
              nextRunAt: input.nextRunAt,
              status: 'ACTIVE',
              consecutiveFailures: 0,
              lastFailureAt: null,
              lastFailureCode: null,
              lockedAt: null,
              lockToken: null,
            },
          })
        : await transaction.ecacMonitoringPlan.create({
            data: {
              id: input.id,
              tenantId: input.tenantId,
              companyId: input.companyId,
              powerOfAttorneyId: input.powerOfAttorneyId,
              queryType: input.queryType,
              intervalMinutes: input.intervalMinutes,
              maxAttempts: input.maxAttempts,
              nextRunAt: input.nextRunAt,
              createdById: input.actorId,
            },
          });

      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: existing
            ? 'ecac.monitoring_plan.updated'
            : 'ecac.monitoring_plan.created',
          entityType: 'ecac_monitoring_plan',
          entityId: plan.id,
          metadata: {
            companyId: input.companyId,
            queryType: input.queryType,
            intervalMinutes: input.intervalMinutes,
            nextRunAt: input.nextRunAt.toISOString(),
          },
        },
      });

      return toPlan(plan);
    });
  }

  public async list(
    tenantId: string,
    filter: ListEcacMonitoringPlansFilter = {},
  ): Promise<EcacMonitoringPlan[]> {
    const rows = await this.prisma.ecacMonitoringPlan.findMany({
      where: {
        tenantId,
        ...(filter.companyId ? { companyId: filter.companyId } : {}),
        ...(filter.queryType ? { queryType: filter.queryType } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return rows.map(toPlan);
  }

  public async get(
    tenantId: string,
    planId: string,
  ): Promise<EcacMonitoringPlan | null> {
    const row = await this.prisma.ecacMonitoringPlan.findUnique({
      where: { tenantId_id: { tenantId, id: planId } },
    });
    return row ? toPlan(row) : null;
  }

  public async changeStatusWithAudit(
    input: ChangeEcacMonitoringPlanStatusInput,
  ): Promise<EcacMonitoringPlan> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.ecacMonitoringPlan.findUnique({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.planId } },
      });
      if (!existing) {
        throw new NotFoundError(
          'Plano de monitoramento e-CAC não encontrado.',
          'ECAC_MONITORING_PLAN_NOT_FOUND',
        );
      }
      if (existing.status === input.status) {
        return toPlan(existing);
      }

      const resumed = input.status === 'ACTIVE';
      const plan = await transaction.ecacMonitoringPlan.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.planId } },
        data: {
          status: input.status,
          lockedAt: null,
          lockToken: null,
          ...(resumed
            ? {
                consecutiveFailures: 0,
                lastFailureAt: null,
                lastFailureCode: null,
                nextRunAt:
                  existing.nextRunAt <= input.now ? input.now : existing.nextRunAt,
              }
            : {}),
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: resumed
            ? 'ecac.monitoring_plan.resumed'
            : 'ecac.monitoring_plan.paused',
          entityType: 'ecac_monitoring_plan',
          entityId: plan.id,
          metadata: {
            companyId: plan.companyId,
            queryType: plan.queryType,
            nextRunAt: plan.nextRunAt.toISOString(),
          },
        },
      });
      return toPlan(plan);
    });
  }

  public async deleteWithAudit(
    tenantId: string,
    planId: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.ecacMonitoringPlan.findUnique({
        where: { tenantId_id: { tenantId, id: planId } },
      });
      if (!existing) {
        throw new NotFoundError(
          'Plano de monitoramento e-CAC não encontrado.',
          'ECAC_MONITORING_PLAN_NOT_FOUND',
        );
      }
      await transaction.ecacMonitoringPlan.delete({
        where: { tenantId_id: { tenantId, id: planId } },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: 'ecac.monitoring_plan.deleted',
          entityType: 'ecac_monitoring_plan',
          entityId: planId,
          metadata: {
            companyId: existing.companyId,
            queryType: existing.queryType,
          },
        },
      });
    });
  }

  public async claimDuePlansAcrossTenants(
    input: ClaimEcacMonitoringPlansInput,
  ): Promise<ClaimedEcacMonitoringPlan[]> {
    if (input.limit < 1) {
      return [];
    }
    const limit = Math.min(Math.trunc(input.limit), 100);
    const lockToken = randomUUID();

    const claimed = await this.prisma.$queryRaw<
      Array<{ id: string; scheduledFor: Date }>
    >(Prisma.sql`
      UPDATE "ecac_monitoring_plans"
      SET
        "locked_at" = ${input.claimedAt},
        "lock_token" = ${lockToken}::uuid,
        "updated_at" = ${input.claimedAt}
      WHERE "id" IN (
        SELECT "id"
        FROM "ecac_monitoring_plans"
        WHERE "status" = 'ACTIVE'::"EcacMonitoringPlanStatus"
          AND "next_run_at" <= ${input.claimedAt}
          AND ("locked_at" IS NULL OR "locked_at" <= ${input.staleLockBefore})
        ORDER BY "next_run_at" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "next_run_at" AS "scheduledFor"
    `);
    if (claimed.length === 0) {
      return [];
    }

    const scheduleById = new Map(
      claimed.map((plan) => [plan.id, plan.scheduledFor]),
    );
    const rows = await this.prisma.ecacMonitoringPlan.findMany({
      where: { id: { in: claimed.map((plan) => plan.id) } },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      lockToken,
      tenantId: row.tenantId,
      companyId: row.companyId,
      powerOfAttorneyId: row.powerOfAttorneyId,
      queryType: row.queryType,
      intervalMinutes: row.intervalMinutes,
      maxAttempts: row.maxAttempts,
      consecutiveFailures: row.consecutiveFailures,
      scheduledFor: scheduleById.get(row.id) ?? row.nextRunAt,
      createdById: row.createdById,
    }));
  }

  public async recordRunWithAudit(
    input: RecordEcacMonitoringRunInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.ecacMonitoringPlan.updateMany({
        where: {
          id: input.planId,
          tenantId: input.tenantId,
          lockToken: input.lockToken,
        },
        data: {
          nextRunAt: input.nextRunAt,
          lastRunAt: input.ranAt,
          lastBatchId: input.batchId,
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureCode: null,
          triggeredRuns: { increment: 1 },
          lockedAt: null,
          lockToken: null,
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: null,
          action: 'ecac.monitoring_plan.triggered',
          entityType: 'ecac_monitoring_plan',
          entityId: input.planId,
          metadata: {
            batchId: input.batchId,
            nextRunAt: input.nextRunAt.toISOString(),
          },
        },
      });
      return true;
    });
  }

  public async recordFailureWithAudit(
    input: RecordEcacMonitoringFailureInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.ecacMonitoringPlan.updateMany({
        where: {
          id: input.planId,
          tenantId: input.tenantId,
          lockToken: input.lockToken,
        },
        data: {
          nextRunAt: input.nextRunAt,
          lastFailureAt: input.failedAt,
          lastFailureCode: input.failureCode.slice(0, 120),
          consecutiveFailures: { increment: 1 },
          ...(input.pause ? { status: 'PAUSED' as const } : {}),
          lockedAt: null,
          lockToken: null,
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: null,
          action: input.pause
            ? 'ecac.monitoring_plan.auto_paused'
            : 'ecac.monitoring_plan.failed',
          entityType: 'ecac_monitoring_plan',
          entityId: input.planId,
          metadata: {
            failureCode: input.failureCode.slice(0, 120),
            nextRunAt: input.nextRunAt.toISOString(),
          },
        },
      });
      return true;
    });
  }
}
