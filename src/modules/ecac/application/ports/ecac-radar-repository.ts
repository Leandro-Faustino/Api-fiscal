import type {
  ClaimedEcacJob,
  EcacAlert,
  EcacAlertStatus,
  EcacFinding,
  EcacQueryType,
  EcacSyncBatch,
  EcacSyncBatchStatus,
} from '../../domain/ecac-radar.js';
import type { EcacGatewayFinding } from './ecac-gateway.js';

export interface EcacSyncTarget {
  companyId: string;
  powerOfAttorneyId: string;
}

export interface CreateEcacBatchInput {
  id: string;
  tenantId: string;
  requestKey: string;
  targetHash: string;
  queryType: EcacQueryType;
  requestedById: string;
  maxAttempts: number;
  targets: EcacSyncTarget[];
  now: Date;
}

export interface CompleteEcacJobInput {
  tenantId: string;
  jobId: string;
  lockToken: string;
  provider: string;
  protocol: string | null;
  responseHash: string;
  artifactHash?: string | null;
  findings: EcacGatewayFinding[];
  completedAt: Date;
}

export interface DeferEcacJobInput {
  tenantId: string;
  jobId: string;
  lockToken: string;
  provider: string;
  resumeAt: Date;
  providerStatus: number;
  deferredAt: Date;
}

export interface FailEcacJobInput {
  tenantId: string;
  jobId: string;
  lockToken: string;
  errorCode: string;
  errorMessage: string;
  retriable: boolean;
  failedAt: Date;
}

export interface ListEcacAlertsFilter {
  companyId?: string;
  queryType?: EcacQueryType;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  status?: EcacAlertStatus;
}

export interface EcacRadarRepository {
  createBatchWithAudit(input: CreateEcacBatchInput): Promise<EcacSyncBatch>;
  getBatch(tenantId: string, batchId: string): Promise<EcacSyncBatch | null>;
  listBatches(
    tenantId: string,
    status?: EcacSyncBatchStatus,
    companyId?: string,
  ): Promise<EcacSyncBatch[]>;
  claimDueJobs(
    tenantId: string,
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<ClaimedEcacJob[]>;
  claimDueJobsAcrossTenants(
    limit: number,
    now: Date,
    staleBefore: Date,
  ): Promise<ClaimedEcacJob[]>;
  completeJobWithAudit(input: CompleteEcacJobInput): Promise<boolean>;
  deferJobWithAudit(input: DeferEcacJobInput): Promise<boolean>;
  failJobWithAudit(
    input: FailEcacJobInput,
  ): Promise<'RETRY_SCHEDULED' | 'FAILED' | 'LEASE_LOST'>;
  listFindings(
    tenantId: string,
    companyId?: string,
    severity?: 'INFO' | 'WARNING' | 'CRITICAL',
  ): Promise<EcacFinding[]>;
  listAlerts(
    tenantId: string,
    filter?: ListEcacAlertsFilter,
  ): Promise<EcacAlert[]>;
  acknowledgeAlertWithAudit(
    tenantId: string,
    alertId: string,
    actorId: string,
    acknowledgedAt: Date,
  ): Promise<EcacAlert>;
}
