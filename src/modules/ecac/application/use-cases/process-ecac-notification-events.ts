import type { EcacAlertNotificationRepository } from '../ports/ecac-alert-notification-repository.js';
import type { EcacNotificationDeliveryGateway } from '../ports/ecac-notification-delivery-gateway.js';

interface Dependencies {
  ecacAlertNotificationRepository: EcacAlertNotificationRepository;
  ecacNotificationDeliveryGateway: EcacNotificationDeliveryGateway;
  ecacNotificationRetryDelayMs: number;
}

export interface ProcessEcacNotificationEventsResult {
  claimed: number;
  delivered: number;
  failed: number;
  retryScheduled: number;
  missing: number;
}

const emptyResult = (): ProcessEcacNotificationEventsResult => ({
  claimed: 0,
  delivered: 0,
  failed: 0,
  retryScheduled: 0,
  missing: 0,
});

function failureCode(value: string | undefined): string {
  const normalized = (value ?? 'UNKNOWN_DELIVERY_FAILURE')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
  return normalized.slice(0, 80) || 'UNKNOWN_DELIVERY_FAILURE';
}

export class ProcessEcacNotificationEventsUseCase {
  private readonly repository: EcacAlertNotificationRepository;
  private readonly gateway: EcacNotificationDeliveryGateway;
  private readonly retryDelayMs: number;

  public constructor({
    ecacAlertNotificationRepository,
    ecacNotificationDeliveryGateway,
    ecacNotificationRetryDelayMs,
  }: Dependencies) {
    this.repository = ecacAlertNotificationRepository;
    this.gateway = ecacNotificationDeliveryGateway;
    this.retryDelayMs = ecacNotificationRetryDelayMs;
  }

  public async executeScheduled(
    batchSize: number,
    processingTtlMs: number,
  ): Promise<ProcessEcacNotificationEventsResult> {
    const result = emptyResult();
    const claimedAt = new Date();
    const events = await this.repository.claimPendingEvents({
      limit: batchSize,
      claimedAt,
      staleProcessingBefore: new Date(claimedAt.getTime() - processingTtlMs),
    });
    result.claimed = events.length;

    for (const event of events) {
      try {
        const delivery = await this.gateway.deliver(event);
        if (delivery.delivered) {
          const delivered = await this.repository.markEventDeliveredByWorker(
            event.tenantId,
            event.id,
            new Date(),
          );
          if (delivered) {
            result.delivered += 1;
          } else {
            result.missing += 1;
          }
          continue;
        }
        const retryAt =
          delivery.retryable !== false && event.attemptCount < event.maxAttempts
            ? new Date(Date.now() + this.retryDelayMs)
            : null;
        const failed = await this.repository.markEventFailedByWorker({
          tenantId: event.tenantId,
          eventId: event.id,
          failedAt: new Date(),
          failureCode: failureCode(delivery.failureCode),
          retryAt,
        });
        if (!failed) {
          result.missing += 1;
        } else if (retryAt) {
          result.retryScheduled += 1;
        } else {
          result.failed += 1;
        }
      } catch (error: unknown) {
        const retryAt =
          event.attemptCount < event.maxAttempts
            ? new Date(Date.now() + this.retryDelayMs)
            : null;
        const failed = await this.repository.markEventFailedByWorker({
          tenantId: event.tenantId,
          eventId: event.id,
          failedAt: new Date(),
          failureCode: failureCode(
            error instanceof Error ? error.name : 'UNKNOWN_DELIVERY_ERROR',
          ),
          retryAt,
        });
        if (!failed) {
          result.missing += 1;
        } else if (retryAt) {
          result.retryScheduled += 1;
        } else {
          result.failed += 1;
        }
      }
    }

    return result;
  }
}
