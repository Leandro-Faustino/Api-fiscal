import type {
  ClaimedEcacJob,
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
  provider: string;
  resumeAt: Date;
  providerStatus: number;
  deferredAt: Date;
}

export interface FailEcacJobInput {
  tenantId: string;
  jobId: string;
  errorCode: string;
  errorMessage: string;
  retriable: boolean;
  failedAt: Date;
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
  completeJobWithAudit(input: CompleteEcacJobInput): Promise<void>;
  deferJobWithAudit(input: DeferEcacJobInput): Promise<void>;
  failJobWithAudit(input: FailEcacJobInput): Promise<'RETRY_SCHEDULED' | 'FAILED'>;
  listFindings(
    tenantId: string,
    companyId?: string,
    severity?: 'INFO' | 'WARNING' | 'CRITICAL',
  ): Promise<EcacFinding[]>;
}
