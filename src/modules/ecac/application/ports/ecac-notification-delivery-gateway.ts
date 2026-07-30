import type { EcacAlertNotificationEvent } from '../../domain/ecac-radar.js';

export interface EcacNotificationDeliveryResult {
  delivered: boolean;
  failureCode?: string;
  retryable?: boolean;
}

export interface EcacNotificationDeliveryGateway {
  deliver(
    event: EcacAlertNotificationEvent,
  ): Promise<EcacNotificationDeliveryResult>;
}
