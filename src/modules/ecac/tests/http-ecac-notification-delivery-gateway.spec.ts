import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { EcacAlertNotificationEvent } from '../domain/ecac-radar.js';
import {
  type EcacEmailMessage,
  type EcacEmailTransport,
  HttpEcacNotificationDeliveryGateway,
} from '../infra/gateways/http-ecac-notification-delivery-gateway.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000004';
const now = new Date('2026-07-26T21:00:00.000Z');

function event(
  overrides: Partial<EcacAlertNotificationEvent> = {},
): EcacAlertNotificationEvent {
  return {
    id: '10000000-0000-4000-8000-000000000002',
    tenantId,
    alertId: '10000000-0000-4000-8000-000000000003',
    userId,
    companyId: '10000000-0000-4000-8000-000000000005',
    queryType: 'TAX_STATUS',
    channel: 'EMAIL',
    status: 'PROCESSING',
    changeType: 'NEW',
    severity: 'CRITICAL',
    title: 'Débito <pendente>',
    scheduledAt: now,
    attemptCount: 1,
    maxAttempts: 3,
    processingStartedAt: now,
    lastAttemptedAt: now,
    deliveredAt: null,
    failedAt: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function prisma(recipient: { email: string } | null): PrismaClient {
  return {
    user: {
      findFirst: vi.fn(async () => recipient),
    },
  } as unknown as PrismaClient;
}

function transport(
  implementation: EcacEmailTransport['sendMail'] = vi.fn(async () => ({
    statusCode: 202,
  })),
): EcacEmailTransport {
  return {
    sendMail: implementation,
  };
}

function gateway(input: {
  prisma?: PrismaClient;
  provider?: 'disabled' | 'http';
  transport?: EcacEmailTransport | null;
} = {}): HttpEcacNotificationDeliveryGateway {
  return new HttpEcacNotificationDeliveryGateway({
    prismaClient: input.prisma ?? prisma({ email: 'owner@example.com' }),
    ecacEmailProvider: input.provider ?? 'http',
    ecacEmailHttpUrl: 'https://email.example.com/send',
    ecacEmailHttpAuthorization: 'Bearer secret',
    ecacEmailFrom: 'API Fiscal <alertas@example.com>',
    ecacEmailSubjectPrefix: '[Control]',
    ecacEmailTimeoutMs: 10_000,
    ecacEmailTransport: input.transport ?? transport(),
  });
}

describe('gateway HTTP de notificações e-CAC', () => {
  it('mantém entrega interna para eventos IN_APP', async () => {
    const sendMail = vi.fn(async () => ({ statusCode: 202 }));
    const sut = gateway({ transport: transport(sendMail) });

    await expect(sut.deliver(event({ channel: 'IN_APP' }))).resolves.toEqual({
      delivered: true,
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('falha de forma terminal quando o provedor HTTP está desabilitado', async () => {
    await expect(gateway({ provider: 'disabled' }).deliver(event())).resolves.toEqual({
      delivered: false,
      failureCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('envia payload de e-mail para usuário ativo do tenant do evento', async () => {
    const sendMail = vi.fn(async (_message: EcacEmailMessage) => ({
      statusCode: 202,
    }));
    const db = prisma({ email: 'owner@example.com' });
    const sut = gateway({ prisma: db, transport: transport(sendMail) });

    await expect(sut.deliver(event())).resolves.toEqual({ delivered: true });
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: userId,
        status: 'ACTIVE',
        memberships: {
          some: {
            tenantId,
            status: 'ACTIVE',
          },
        },
      },
      select: { email: true },
    });
    const sent = sendMail.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      from: 'API Fiscal <alertas@example.com>',
      to: 'owner@example.com',
      subject: '[Control] Alerta e-CAC CRITICAL: Débito <pendente>',
      metadata: {
        tenantId,
        alertId: '10000000-0000-4000-8000-000000000003',
        notificationEventId: '10000000-0000-4000-8000-000000000002',
        channel: 'EMAIL',
      },
    });
    expect(sent?.text).toContain('Alerta e-CAC: Débito <pendente>');
    expect(sent?.html).toContain('Débito &lt;pendente&gt;');
  });

  it('falha de forma terminal quando destinatário não existe no tenant', async () => {
    const sut = gateway({ prisma: prisma(null) });

    await expect(sut.deliver(event())).resolves.toEqual({
      delivered: false,
      failureCode: 'EMAIL_RECIPIENT_NOT_FOUND',
      retryable: false,
    });
  });

  it('classifica 4xx como terminal, 5xx como retry e erro de rede como retry', async () => {
    const terminal = gateway({
      transport: transport(async () => ({ statusCode: 422 })),
    });
    await expect(terminal.deliver(event())).resolves.toEqual({
      delivered: false,
      failureCode: 'EMAIL_HTTP_422',
      retryable: false,
    });

    const serverError = gateway({
      transport: transport(async () => ({ statusCode: 503 })),
    });
    await expect(serverError.deliver(event())).resolves.toEqual({
      delivered: false,
      failureCode: 'EMAIL_HTTP_503',
      retryable: true,
    });

    const retry = gateway({
      transport: transport(async () => {
        throw new Error('temporary network failure');
      }),
    });
    await expect(retry.deliver(event())).resolves.toEqual({
      delivered: false,
      failureCode: 'ERROR',
      retryable: true,
    });
  });
});
