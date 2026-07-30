import { createHash } from 'node:crypto';

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

export type EcacAlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export type EcacAlertChangeType = 'NEW' | 'CHANGED' | 'REOPENED' | 'RESOLVED';

export type EcacNotificationChannel = 'IN_APP' | 'EMAIL';

export type EcacNotificationEventStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'DELIVERED'
  | 'FAILED';

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

export interface EcacAlert {
  id: string;
  tenantId: string;
  companyId: string;
  latestJobId: string;
  queryType: EcacQueryType;
  findingKey: string;
  code: string;
  category: string;
  title: string;
  description: string | null;
  severity: EcacFindingSeverity;
  status: EcacAlertStatus;
  lastChangeType: EcacAlertChangeType;
  firstObservedAt: Date;
  lastObservedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EcacAlertNotificationPreference {
  id: string;
  tenantId: string;
  userId: string;
  channel: EcacNotificationChannel;
  enabled: boolean;
  minimumSeverity: EcacFindingSeverity;
  includeResolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EcacAlertNotificationEvent {
  id: string;
  tenantId: string;
  alertId: string;
  userId: string;
  companyId: string;
  queryType: EcacQueryType;
  channel: EcacNotificationChannel;
  status: EcacNotificationEventStatus;
  changeType: EcacAlertChangeType;
  severity: EcacFindingSeverity;
  title: string;
  scheduledAt: Date;
  attemptCount: number;
  maxAttempts: number;
  processingStartedAt: Date | null;
  lastAttemptedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EcacNotificationEventSummary {
  total: number;
  byStatus: Record<EcacNotificationEventStatus, number>;
  byChannel: Record<EcacNotificationChannel, number>;
  nextPendingAt: Date | null;
  lastDeliveredAt: Date | null;
  lastFailedAt: Date | null;
  lastFailureCode: string | null;
}

export interface EcacNotificationEventAuditEntry {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  occurredAt: Date;
}

export interface ComparableEcacFinding {
  code: string;
  category: string;
  title: string;
  description?: string | null;
  severity: EcacFindingSeverity;
  sourceReference?: string | null;
  observedAt: Date;
}

export interface FingerprintedEcacFinding extends ComparableEcacFinding {
  findingKey: string;
  contentHash: string;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function sha256(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function fingerprintEcacFinding(
  finding: ComparableEcacFinding,
): FingerprintedEcacFinding {
  const sourceIdentity =
    normalized(finding.sourceReference) || normalized(finding.title);
  const findingKey = sha256([
    normalized(finding.code),
    sourceIdentity,
  ]);
  const contentHash = sha256([
    normalized(finding.category),
    normalized(finding.title),
    normalized(finding.description),
    finding.severity,
  ]);
  return { ...finding, findingKey, contentHash };
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
