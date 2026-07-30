import type {
  EcacAlertNotificationEvent,
  EcacAlertNotificationPreference,
  EcacFindingSeverity,
  EcacNotificationChannel,
  EcacNotificationEventAuditEntry,
  EcacNotificationEventSummary,
  EcacNotificationEventStatus,
  EcacQueryType,
} from '../../domain/ecac-radar.js';

export interface UpsertEcacNotificationPreferenceInput {
  tenantId: string;
  userId: string;
  channel: EcacNotificationChannel;
  enabled: boolean;
  minimumSeverity: EcacFindingSeverity;
  includeResolved: boolean;
  updatedAt: Date;
}

export interface ListEcacNotificationEventsFilter {
  channel?: EcacNotificationChannel;
  status?: EcacNotificationEventStatus;
  companyId?: string;
  queryType?: EcacQueryType;
  severity?: EcacFindingSeverity;
  scheduledFrom?: Date;
  scheduledTo?: Date;
  limit?: number;
}

export interface ClaimEcacNotificationEventsInput {
  limit: number;
  claimedAt: Date;
  staleProcessingBefore: Date;
}

export interface MarkEcacNotificationEventFailedInput {
  tenantId: string;
  eventId: string;
  failedAt: Date;
  failureCode: string;
  retryAt?: Date | null;
}

export interface EcacAlertNotificationRepository {
  listPreferences(
    tenantId: string,
    userId: string,
  ): Promise<EcacAlertNotificationPreference[]>;
  upsertPreference(
    input: UpsertEcacNotificationPreferenceInput,
  ): Promise<EcacAlertNotificationPreference>;
  listEvents(
    tenantId: string,
    userId: string,
    filter?: ListEcacNotificationEventsFilter,
  ): Promise<EcacAlertNotificationEvent[]>;
  getEvent(
    tenantId: string,
    userId: string,
    eventId: string,
  ): Promise<EcacAlertNotificationEvent | null>;
  listEventAuditTrail(
    tenantId: string,
    eventId: string,
    limit: number,
  ): Promise<EcacNotificationEventAuditEntry[]>;
  summarizeEvents(
    tenantId: string,
    userId: string,
  ): Promise<EcacNotificationEventSummary>;
  markEventDelivered(
    tenantId: string,
    userId: string,
    eventId: string,
    deliveredAt: Date,
  ): Promise<EcacAlertNotificationEvent>;
  retryFailedEvent(
    tenantId: string,
    userId: string,
    eventId: string,
    scheduledAt: Date,
  ): Promise<EcacAlertNotificationEvent>;
  claimPendingEvents(
    input: ClaimEcacNotificationEventsInput,
  ): Promise<EcacAlertNotificationEvent[]>;
  markEventDeliveredByWorker(
    tenantId: string,
    eventId: string,
    deliveredAt: Date,
  ): Promise<EcacAlertNotificationEvent | null>;
  markEventFailedByWorker(
    input: MarkEcacNotificationEventFailedInput,
  ): Promise<EcacAlertNotificationEvent | null>;
}
