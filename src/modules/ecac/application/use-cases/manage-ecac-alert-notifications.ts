import {
  NotFoundError,
  ValidationError,
} from '../../../../shared/domain/app-error.js';
import { ecacQueryTypes } from '../../domain/ecac-radar.js';
import type {
  EcacAlertNotificationEvent,
  EcacAlertNotificationPreference,
  EcacFindingSeverity,
  EcacNotificationChannel,
  EcacNotificationEventSummary,
  EcacNotificationEventStatus,
  EcacQueryType,
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
const maxListEventsLimit = 200;

export interface ListEcacNotificationEventsInput {
  channel?: EcacNotificationChannel;
  status?: EcacNotificationEventStatus;
  companyId?: string;
  queryType?: EcacQueryType;
  severity?: EcacFindingSeverity;
  scheduledFrom?: string | Date;
  scheduledTo?: string | Date;
  limit?: number;
}

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

function ensureQueryType(queryType: EcacQueryType): void {
  if (!ecacQueryTypes.includes(queryType)) {
    throw new ValidationError('Tipo de consulta e-CAC inválido.');
  }
}

function parseOptionalDate(value: string | Date | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ValidationError('Filtro de data inválido.', { field });
    }
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('Filtro de data inválido.', { field });
  }
  return parsed;
}

function normalizeListEventsFilter(
  filter: ListEcacNotificationEventsInput,
): ListEcacNotificationEventsFilter {
  if (filter.channel) {
    ensureChannel(filter.channel);
  }
  if (filter.status) {
    ensureStatus(filter.status);
  }
  if (filter.queryType) {
    ensureQueryType(filter.queryType);
  }
  if (filter.severity) {
    ensureSeverity(filter.severity);
  }
  const scheduledFrom = parseOptionalDate(filter.scheduledFrom, 'scheduledFrom');
  const scheduledTo = parseOptionalDate(filter.scheduledTo, 'scheduledTo');
  if (scheduledFrom && scheduledTo && scheduledFrom > scheduledTo) {
    throw new ValidationError('Período de agendamento inválido.');
  }
  const limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxListEventsLimit) {
    throw new ValidationError(
      `A listagem de eventos deve ter limite entre 1 e ${maxListEventsLimit}.`,
    );
  }
  const normalized: ListEcacNotificationEventsFilter = { limit };
  if (filter.channel) {
    normalized.channel = filter.channel;
  }
  if (filter.status) {
    normalized.status = filter.status;
  }
  if (filter.companyId) {
    normalized.companyId = filter.companyId;
  }
  if (filter.queryType) {
    normalized.queryType = filter.queryType;
  }
  if (filter.severity) {
    normalized.severity = filter.severity;
  }
  if (scheduledFrom) {
    normalized.scheduledFrom = scheduledFrom;
  }
  if (scheduledTo) {
    normalized.scheduledTo = scheduledTo;
  }
  return normalized;
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
    filter: ListEcacNotificationEventsInput = {},
  ): Promise<EcacAlertNotificationEvent[]> {
    return this.repository.listEvents(
      tenantId,
      userId,
      normalizeListEventsFilter(filter),
    );
  }
}

export class SummarizeEcacNotificationEventsUseCase {
  private readonly repository: EcacAlertNotificationRepository;

  public constructor({ ecacAlertNotificationRepository }: Dependencies) {
    this.repository = ecacAlertNotificationRepository;
  }

  public execute(
    tenantId: string,
    userId: string,
  ): Promise<EcacNotificationEventSummary> {
    return this.repository.summarizeEvents(tenantId, userId);
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
