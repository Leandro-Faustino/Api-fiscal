import { randomUUID } from 'node:crypto';
import {
  NotFoundError,
  ValidationError,
} from '../../../../shared/domain/app-error.js';
import type {
  EcacMonitoringPlanRepository,
  ListEcacMonitoringPlansFilter,
} from '../ports/ecac-monitoring-plan-repository.js';
import {
  MAXIMUM_MONITORING_INTERVAL_MINUTES,
  MINIMUM_MONITORING_INTERVAL_MINUTES,
  type EcacMonitoringPlan,
} from '../../domain/ecac-monitoring-plan.js';
import { ecacQueryTypes, type EcacQueryType } from '../../domain/ecac-radar.js';

interface Dependencies {
  ecacMonitoringPlanRepository: EcacMonitoringPlanRepository;
}

export interface UpsertEcacMonitoringPlanCommand {
  tenantId: string;
  actorId: string;
  companyId: string;
  powerOfAttorneyId: string;
  queryType: EcacQueryType;
  intervalMinutes: number;
  maxAttempts?: number;
  startAt?: string;
}

export class UpsertEcacMonitoringPlanUseCase {
  private readonly repository: EcacMonitoringPlanRepository;

  public constructor({ ecacMonitoringPlanRepository }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
  }

  public async execute(
    command: UpsertEcacMonitoringPlanCommand,
  ): Promise<EcacMonitoringPlan> {
    if (!ecacQueryTypes.includes(command.queryType)) {
      throw new ValidationError('Tipo de consulta e-CAC inválido.');
    }
    if (
      !Number.isInteger(command.intervalMinutes) ||
      command.intervalMinutes < MINIMUM_MONITORING_INTERVAL_MINUTES ||
      command.intervalMinutes > MAXIMUM_MONITORING_INTERVAL_MINUTES
    ) {
      throw new ValidationError(
        `O intervalo deve ser um inteiro entre ${MINIMUM_MONITORING_INTERVAL_MINUTES} e ${MAXIMUM_MONITORING_INTERVAL_MINUTES} minutos.`,
      );
    }

    const maxAttempts = command.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new ValidationError('maxAttempts deve ser um inteiro entre 1 e 10.');
    }

    const now = new Date();
    const nextRunAt = command.startAt ? new Date(command.startAt) : now;
    if (Number.isNaN(nextRunAt.getTime())) {
      throw new ValidationError('A data inicial do monitoramento é inválida.');
    }
    const horizonMs =
      MAXIMUM_MONITORING_INTERVAL_MINUTES * 60_000 + 24 * 3_600_000;
    if (nextRunAt.getTime() > now.getTime() + horizonMs) {
      throw new ValidationError(
        'A data inicial do monitoramento está distante demais.',
      );
    }

    return this.repository.upsertWithAudit({
      id: randomUUID(),
      tenantId: command.tenantId,
      companyId: command.companyId,
      powerOfAttorneyId: command.powerOfAttorneyId,
      queryType: command.queryType,
      intervalMinutes: command.intervalMinutes,
      maxAttempts,
      nextRunAt: nextRunAt < now ? now : nextRunAt,
      actorId: command.actorId,
      now,
    });
  }
}

export class ListEcacMonitoringPlansUseCase {
  private readonly repository: EcacMonitoringPlanRepository;

  public constructor({ ecacMonitoringPlanRepository }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
  }

  public execute(
    tenantId: string,
    filter: ListEcacMonitoringPlansFilter = {},
  ): Promise<EcacMonitoringPlan[]> {
    return this.repository.list(tenantId, filter);
  }
}

export class GetEcacMonitoringPlanUseCase {
  private readonly repository: EcacMonitoringPlanRepository;

  public constructor({ ecacMonitoringPlanRepository }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
  }

  public async execute(
    tenantId: string,
    planId: string,
  ): Promise<EcacMonitoringPlan> {
    const plan = await this.repository.get(tenantId, planId);
    if (!plan) {
      throw new NotFoundError(
        'Plano de monitoramento e-CAC não encontrado.',
        'ECAC_MONITORING_PLAN_NOT_FOUND',
      );
    }
    return plan;
  }
}

export class PauseEcacMonitoringPlanUseCase {
  private readonly repository: EcacMonitoringPlanRepository;

  public constructor({ ecacMonitoringPlanRepository }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
  }

  public execute(
    tenantId: string,
    planId: string,
    actorId: string,
  ): Promise<EcacMonitoringPlan> {
    return this.repository.changeStatusWithAudit({
      tenantId,
      planId,
      status: 'PAUSED',
      actorId,
      now: new Date(),
    });
  }
}

export class ResumeEcacMonitoringPlanUseCase {
  private readonly repository: EcacMonitoringPlanRepository;

  public constructor({ ecacMonitoringPlanRepository }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
  }

  public execute(
    tenantId: string,
    planId: string,
    actorId: string,
  ): Promise<EcacMonitoringPlan> {
    return this.repository.changeStatusWithAudit({
      tenantId,
      planId,
      status: 'ACTIVE',
      actorId,
      now: new Date(),
    });
  }
}

export class DeleteEcacMonitoringPlanUseCase {
  private readonly repository: EcacMonitoringPlanRepository;

  public constructor({ ecacMonitoringPlanRepository }: Dependencies) {
    this.repository = ecacMonitoringPlanRepository;
  }

  public execute(
    tenantId: string,
    planId: string,
    actorId: string,
  ): Promise<void> {
    return this.repository.deleteWithAudit(tenantId, planId, actorId);
  }
}
