import type {
  EcacAlertNotificationEvent,
  EcacAlertNotificationPreference,
  EcacFindingSeverity,
  EcacNotificationChannel,
  EcacNotificationEventStatus,
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
  markEventDelivered(
    tenantId: string,
    userId: string,
    eventId: string,
    deliveredAt: Date,
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
