import { AppError, ValidationError } from '../../../../shared/domain/app-error.js';
import type { EcacMonitoringPlanRepository } from '../ports/ecac-monitoring-plan-repository.js';
import {
  computeNextMonitoringRun,
  monitoringRequestKey,
  MONITORING_FAILURES_BEFORE_PAUSE,
  type ClaimedEcacMonitoringPlan,
} from '../../domain/ecac-monitoring-plan.js';
import type { RequestEcacSyncUseCase } from './request-ecac-sync.js';

interface Dependencies {
  ecacMonitoringPlanRepository: EcacMonitoringPlanRepository;
  requestEcacSyncUseCase: Pick<RequestEcacSyncUseCase, 'execute'>;
}

export interface RunEcacMonitoringResult {
  claimed: number;
  triggered: number;
  failed: number;
  paused: number;
  leaseLost: number;
}

function failureCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  return 'ECAC_MONITORING_UNEXPECTED_ERROR';
}

export class RunEcacMonitoringUseCase {
  private readonly repository: EcacMonitoringPlanRepository;
  private readonly requestSync: Pick<RequestEcacSyncUseCase, 'execute'>;

  public constructor({
    ecacMonitoringPlanRepository,
    requestEcacSyncUseCase,
  }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
    this.requestSync = requestEcacSyncUseCase;
  }

  public async executeScheduled(
    limit: number,
    lockTtlMs: number,
  ): Promise<RunEcacMonitoringResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError(
        'O limite do agendador deve ser um inteiro entre 1 e 100.',
      );
    }
    if (!Number.isInteger(lockTtlMs) || lockTtlMs < 60_000) {
      throw new ValidationError('O TTL do lock deve ser de pelo menos 60 segundos.');
    }

    const now = new Date();
    const plans = await this.repository.claimDuePlansAcrossTenants({
      limit,
      claimedAt: now,
      staleLockBefore: new Date(now.getTime() - lockTtlMs),
    });

    const summary: RunEcacMonitoringResult = {
      claimed: plans.length,
      triggered: 0,
      failed: 0,
      paused: 0,
      leaseLost: 0,
    };

    for (const plan of plans) {
      await this.runPlan(plan, summary);
    }

    return summary;
  }

  private async runPlan(
    plan: ClaimedEcacMonitoringPlan,
    summary: RunEcacMonitoringResult,
  ): Promise<void> {
    const nextRunAt = computeNextMonitoringRun(
      plan.scheduledFor,
      plan.intervalMinutes,
      new Date(),
    );

    try {
      const batch = await this.requestSync.execute({
        tenantId: plan.tenantId,
        actorId: plan.createdById,
        requestKey: monitoringRequestKey(plan.id, plan.scheduledFor),
        queryType: plan.queryType,
        maxAttempts: plan.maxAttempts,
        targets: [
          {
            companyId: plan.companyId,
            powerOfAttorneyId: plan.powerOfAttorneyId,
          },
        ],
      });
      const recorded = await this.repository.recordRunWithAudit({
        tenantId: plan.tenantId,
        planId: plan.id,
        lockToken: plan.lockToken,
        batchId: batch.id,
        nextRunAt,
        ranAt: new Date(),
      });
      if (recorded) {
        summary.triggered += 1;
      } else {
        summary.leaseLost += 1;
      }
    } catch (error: unknown) {
      const pause =
        plan.consecutiveFailures + 1 >= MONITORING_FAILURES_BEFORE_PAUSE;
      const recorded = await this.repository.recordFailureWithAudit({
        tenantId: plan.tenantId,
        planId: plan.id,
        lockToken: plan.lockToken,
        failureCode: failureCode(error),
        nextRunAt,
        failedAt: new Date(),
        pause,
      });
      if (!recorded) {
        summary.leaseLost += 1;
        return;
      }
      summary.failed += 1;
      if (pause) {
        summary.paused += 1;
      }
    }
  }
}
