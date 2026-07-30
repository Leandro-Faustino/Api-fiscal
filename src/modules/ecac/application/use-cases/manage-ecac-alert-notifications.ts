import {
  NotFoundError,
  ValidationError,
} from '../../../../shared/domain/app-error.js';
import type {
  EcacAlertNotificationEvent,
  EcacAlertNotificationPreference,
  EcacFindingSeverity,
  EcacNotificationChannel,
  EcacNotificationEventStatus,
} from '../../domain/ecac-radar.js';
import type {
  EcacAlertNotificationRepository,
  ListEcacNotificationEventsFilter,
} from '../ports/ecac-alert-notification-repository.js';

interface Dependencies {
  ecacAlertNotificationRepository: EcacAlertNotificationRepository;
}

const channels: EcacNotificationChannel[] = ['IN_APP', 'EMAIL'];
const severities: EcacFindingSeverity[] = ['INFO', 'WARNING', 'CRITICAL'];
const eventStatuses: EcacNotificationEventStatus[] = [
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED',
];

export interface UpdateEcacNotificationPreferenceInput {
  tenantId: string;
  userId: string;
  channel: EcacNotificationChannel;
  enabled: boolean;
  minimumSeverity: EcacFindingSeverity;
  includeResolved: boolean;
}

function ensureChannel(channel: EcacNotificationChannel): void {
  if (!channels.includes(channel)) {
    throw new ValidationError('Canal de notificação e-CAC inválido.');
  }
}

function ensureSeverity(severity: EcacFindingSeverity): void {
  if (!severities.includes(severity)) {
    throw new ValidationError('Severidade mínima inválida.');
  }
}

function ensureStatus(status: EcacNotificationEventStatus): void {
  if (!eventStatuses.includes(status)) {
    throw new ValidationError('Status de evento de notificação inválido.');
  }
}

export class ListEcacNotificationPreferencesUseCase {
  private readonly repository: EcacAlertNotificationRepository;

  public constructor({ ecacAlertNotificationRepository }: Dependencies) {
    this.repository = ecacAlertNotificationRepository;
  }

  public execute(
    tenantId: string,
    userId: string,
  ): Promise<EcacAlertNotificationPreference[]> {
    return this.repository.listPreferences(tenantId, userId);
  }
}

export class UpdateEcacNotificationPreferenceUseCase {
  private readonly repository: EcacAlertNotificationRepository;

  public constructor({ ecacAlertNotificationRepository }: Dependencies) {
    this.repository = ecacAlertNotificationRepository;
  }

  public execute(
    input: UpdateEcacNotificationPreferenceInput,
  ): Promise<EcacAlertNotificationPreference> {
    ensureChannel(input.channel);
    ensureSeverity(input.minimumSeverity);
    return this.repository.upsertPreference({
      ...input,
      updatedAt: new Date(),
    });
  }
}

export class ListEcacNotificationEventsUseCase {
  private readonly repository: EcacAlertNotificationRepository;

  public constructor({ ecacAlertNotificationRepository }: Dependencies) {
    this.repository = ecacAlertNotificationRepository;
  }

  public execute(
    tenantId: string,
    userId: string,
    filter: ListEcacNotificationEventsFilter = {},
  ): Promise<EcacAlertNotificationEvent[]> {
    if (filter.channel) {
      ensureChannel(filter.channel);
    }
    if (filter.status) {
      ensureStatus(filter.status);
    }
    return this.repository.listEvents(tenantId, userId, filter);
  }
}

export class MarkEcacNotificationEventDeliveredUseCase {
  private readonly repository: EcacAlertNotificationRepository;

  public constructor({ ecacAlertNotificationRepository }: Dependencies) {
    this.repository = ecacAlertNotificationRepository;
  }

  public async execute(
    tenantId: string,
    userId: string,
    eventId: string,
  ): Promise<EcacAlertNotificationEvent> {
    const event = await this.repository.markEventDelivered(
      tenantId,
      userId,
      eventId,
      new Date(),
    );
    if (!event) {
      throw new NotFoundError(
        'Evento de notificação e-CAC não encontrado.',
        'ECAC_NOTIFICATION_EVENT_NOT_FOUND',
      );
    }
    return event;
  }
}
