import type { EcacNotificationDeliveryGateway } from '../../application/ports/ecac-notification-delivery-gateway.js';
import type { EcacAlertNotificationEvent } from '../../domain/ecac-radar.js';

export class InternalEcacNotificationDeliveryGateway
  implements EcacNotificationDeliveryGateway
{
  public async deliver(
    event: EcacAlertNotificationEvent,
  ): Promise<{ delivered: boolean; failureCode?: string; retryable?: boolean }> {
    if (event.channel === 'IN_APP') {
      return { delivered: true };
    }

    return {
      delivered: false,
      failureCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      retryable: false,
    };
  }
}
