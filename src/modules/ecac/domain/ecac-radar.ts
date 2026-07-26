export type EcacQueryType = 'TAX_STATUS' | 'DEBTS' | 'MAILBOX';

export type EcacSyncBatchStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED';

export type EcacSyncJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRY_SCHEDULED'
  | 'SUCCEEDED'
  | 'FAILED';

export type EcacFindingSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface EcacFinding {
  id: string;
  tenantId: string;
  companyId: string;
  jobId: string;
  code: string;
  category: string;
  title: string;
  description: string | null;
  severity: EcacFindingSeverity;
  sourceReference: string | null;
  observedAt: Date;
  createdAt: Date;
}

export interface EcacSyncJob {
  id: string;
  tenantId: string;
  batchId: string;
  companyId: string;
  companyCnpj: string;
  powerOfAttorneyId: string;
  certificateId: string;
  queryType: EcacQueryType;
  status: EcacSyncJobStatus;
  provider: string | null;
  protocol: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  findings: EcacFinding[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EcacSyncBatch {
  id: string;
  tenantId: string;
  requestKey: string;
  queryType: EcacQueryType;
  status: EcacSyncBatchStatus;
  requestedById: string;
  totalJobs: number;
  succeededJobs: number;
  failedJobs: number;
  jobs: EcacSyncJob[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimedEcacJob {
  id: string;
  lockToken: string;
  tenantId: string;
  batchId: string;
  companyId: string;
  companyCnpj: string;
  powerOfAttorneyId: string;
  certificateId: string;
  queryType: EcacQueryType;
  attemptCount: number;
  maxAttempts: number;
  authorizationValid: boolean;
}

export const ecacQueryTypes: readonly EcacQueryType[] = [
  'TAX_STATUS',
  'DEBTS',
  'MAILBOX',
];
