import type {
  ClaimedEcacMonitoringPlan,
  EcacMonitoringPlan,
  EcacMonitoringPlanStatus,
} from '../../domain/ecac-monitoring-plan.js';
import type { EcacQueryType } from '../../domain/ecac-radar.js';

export interface UpsertEcacMonitoringPlanInput {
  id: string;
  tenantId: string;
  companyId: string;
  powerOfAttorneyId: string;
  queryType: EcacQueryType;
  intervalMinutes: number;
  maxAttempts: number;
  nextRunAt: Date;
  actorId: string;
  now: Date;
}

export interface ListEcacMonitoringPlansFilter {
  companyId?: string;
  queryType?: EcacQueryType;
  status?: EcacMonitoringPlanStatus;
}

export interface ChangeEcacMonitoringPlanStatusInput {
  tenantId: string;
  planId: string;
  status: EcacMonitoringPlanStatus;
  actorId: string;
  now: Date;
}

export interface ClaimEcacMonitoringPlansInput {
  limit: number;
  claimedAt: Date;
  staleLockBefore: Date;
}

export interface RecordEcacMonitoringRunInput {
  tenantId: string;
  planId: string;
  lockToken: string;
  batchId: string;
  nextRunAt: Date;
  ranAt: Date;
}

export interface RecordEcacMonitoringFailureInput {
  tenantId: string;
  planId: string;
  lockToken: string;
  failureCode: string;
  nextRunAt: Date;
  failedAt: Date;
  pause: boolean;
}

export interface EcacMonitoringPlanRepository {
  upsertWithAudit(
    input: UpsertEcacMonitoringPlanInput,
  ): Promise<EcacMonitoringPlan>;
  list(
    tenantId: string,
    filter?: ListEcacMonitoringPlansFilter,
  ): Promise<EcacMonitoringPlan[]>;
  get(tenantId: string, planId: string): Promise<EcacMonitoringPlan | null>;
  changeStatusWithAudit(
    input: ChangeEcacMonitoringPlanStatusInput,
  ): Promise<EcacMonitoringPlan>;
  deleteWithAudit(
    tenantId: string,
    planId: string,
    actorId: string,
  ): Promise<void>;
  claimDuePlansAcrossTenants(
    input: ClaimEcacMonitoringPlansInput,
  ): Promise<ClaimedEcacMonitoringPlan[]>;
  recordRunWithAudit(input: RecordEcacMonitoringRunInput): Promise<boolean>;
  recordFailureWithAudit(
    input: RecordEcacMonitoringFailureInput,
  ): Promise<boolean>;
}
