import type { PrismaClient } from '@prisma/client';
import type { EcacNotificationDeliveryGateway } from '../../application/ports/ecac-notification-delivery-gateway.js';
import type { EcacAlertNotificationEvent } from '../../domain/ecac-radar.js';

type EcacEmailProvider = 'disabled' | 'http';

export interface EcacEmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata: {
    tenantId: string;
    alertId: string;
    notificationEventId: string;
    channel: 'EMAIL';
  };
}

export interface EcacEmailTransport {
  sendMail(message: EcacEmailMessage): Promise<{ statusCode: number }>;
}

interface Dependencies {
  prismaClient: PrismaClient;
  ecacEmailProvider: EcacEmailProvider;
  ecacEmailHttpUrl: string;
  ecacEmailHttpAuthorization: string;
  ecacEmailFrom: string;
  ecacEmailSubjectPrefix: string;
  ecacEmailTimeoutMs: number;
  ecacEmailTransport: EcacEmailTransport | null;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function httpTransport(dependencies: Dependencies): EcacEmailTransport {
  return {
    sendMail: async (message) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), dependencies.ecacEmailTimeoutMs);
      try {
        const response = await fetch(dependencies.ecacEmailHttpUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(dependencies.ecacEmailHttpAuthorization
              ? { authorization: dependencies.ecacEmailHttpAuthorization }
              : {}),
          },
          body: JSON.stringify(message),
          signal: controller.signal,
        });
        return { statusCode: response.status };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function subject(prefix: string, event: EcacAlertNotificationEvent): string {
  const cleanPrefix = prefix.trim();
  const title = `Alerta e-CAC ${event.severity}: ${event.title}`;
  return cleanPrefix ? `${cleanPrefix} ${title}` : title;
}

function messageBody(event: EcacAlertNotificationEvent): {
  text: string;
  html: string;
} {
  const lines = [
    `Alerta e-CAC: ${event.title}`,
    `Severidade: ${event.severity}`,
    `Tipo de mudança: ${event.changeType}`,
    `Consulta: ${event.queryType}`,
    `Empresa: ${event.companyId}`,
    `Alerta: ${event.alertId}`,
    '',
    'Acesse a API Fiscal para revisar o detalhe do alerta e tomar a ação necessária.',
  ];
  const htmlLines = lines
    .map((line) => (line ? `<p>${htmlEscape(line)}</p>` : '<br>'))
    .join('');
  return {
    text: lines.join('\n'),
    html: `<!doctype html><html><body>${htmlLines}</body></html>`,
  };
}

function httpFailureCode(statusCode: number): string {
  return `EMAIL_HTTP_${statusCode}`;
}

export class HttpEcacNotificationDeliveryGateway
  implements EcacNotificationDeliveryGateway
{
  private readonly prisma: PrismaClient;
  private readonly provider: EcacEmailProvider;
  private readonly from: string;
  private readonly subjectPrefix: string;
  private readonly transport: EcacEmailTransport | null;

  public constructor(dependencies: Dependencies) {
    this.prisma = dependencies.prismaClient;
    this.provider = dependencies.ecacEmailProvider;
    this.from = dependencies.ecacEmailFrom;
    this.subjectPrefix = dependencies.ecacEmailSubjectPrefix;
    this.transport =
      dependencies.ecacEmailTransport ??
      (dependencies.ecacEmailProvider === 'http' ? httpTransport(dependencies) : null);
  }

  public async deliver(
    event: EcacAlertNotificationEvent,
  ): Promise<{ delivered: boolean; failureCode?: string; retryable?: boolean }> {
    if (event.channel === 'IN_APP') {
      return { delivered: true };
    }

    if (this.provider !== 'http' || !this.transport) {
      return {
        delivered: false,
        failureCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
        retryable: false,
      };
    }

    const recipient = await this.prisma.user.findFirst({
      where: {
        id: event.userId,
        status: 'ACTIVE',
        memberships: {
          some: {
            tenantId: event.tenantId,
            status: 'ACTIVE',
          },
        },
      },
      select: {
        email: true,
      },
    });
    if (!recipient) {
      return {
        delivered: false,
        failureCode: 'EMAIL_RECIPIENT_NOT_FOUND',
        retryable: false,
      };
    }

    const body = messageBody(event);
    try {
      const response = await this.transport.sendMail({
        from: this.from,
        to: recipient.email,
        subject: subject(this.subjectPrefix, event),
        text: body.text,
        html: body.html,
        metadata: {
          tenantId: event.tenantId,
          alertId: event.alertId,
          notificationEventId: event.id,
          channel: 'EMAIL',
        },
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return { delivered: true };
      }
      return {
        delivered: false,
        failureCode: httpFailureCode(response.statusCode),
        retryable: response.statusCode >= 500,
      };
    } catch (error: unknown) {
      return {
        delivered: false,
        failureCode: error instanceof Error ? error.name.toUpperCase() : 'EMAIL_HTTP_ERROR',
        retryable: true,
      };
    }
  }
}
