import type {
  PrismaClient,
  SerproConnection as PrismaSerproConnection,
} from '@prisma/client';
import { NotFoundError, ValidationError } from '../../../../shared/domain/app-error.js';
import type {
  ConfigureSerproConnectionInput,
  EncryptedSerproConnectionMaterial,
  RecordSerproUseInput,
  RotateSerproConnectionEncryptionInput,
  SerproConnectionMaterial,
  SerproConnectionRepository,
} from '../../application/ports/serpro-connection-repository.js';
import type { SerproConnection } from '../../domain/serpro-connection.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

function toDomain(row: PrismaSerproConnection): SerproConnection {
  return {
    id: row.id,
    tenantId: row.tenantId,
    certificateId: row.certificateId,
    contractorCnpj: row.contractorCnpj,
    requesterCnpj: row.requesterCnpj,
    status: row.status,
    configuredById: row.configuredById,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaSerproConnectionRepository
  implements SerproConnectionRepository
{
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async configureWithAudit(
    input: ConfigureSerproConnectionInput,
  ): Promise<SerproConnection> {
    return this.prisma.$transaction(async (transaction) => {
      const [membership, certificate] = await Promise.all([
        transaction.membership.count({
          where: {
            tenantId: input.tenantId,
            userId: input.actorId,
            status: 'ACTIVE',
          },
        }),
        transaction.digitalCertificate.findFirst({
          where: {
            tenantId: input.tenantId,
            id: input.certificateId,
          },
        }),
      ]);

      if (membership !== 1) {
        throw new NotFoundError(
          'Vínculo ativo não encontrado.',
          'MEMBERSHIP_NOT_FOUND',
        );
      }
      if (!certificate) {
        throw new NotFoundError(
          'Certificado contratante não encontrado.',
          'SERPRO_CERTIFICATE_NOT_FOUND',
        );
      }
      if (
        certificate.status !== 'ACTIVE' ||
        certificate.validFrom > input.configuredAt ||
        certificate.validUntil <= input.configuredAt
      ) {
        throw new ValidationError(
          'O certificado contratante deve estar ativo e dentro da validade.',
        );
      }

      const existing = await transaction.serproConnection.findUnique({
        where: { tenantId: input.tenantId },
      });
      const connection = existing
        ? await transaction.serproConnection.update({
            where: { tenantId: input.tenantId },
            data: {
              certificateId: input.certificateId,
              contractorCnpj: input.contractorCnpj,
              requesterCnpj: input.requesterCnpj,
              encryptedConsumerKey: input.encryptedConsumerKey,
              encryptedConsumerSecret: input.encryptedConsumerSecret,
              keyVersion: input.keyVersion,
              status: 'ACTIVE',
              configuredById: input.actorId,
              revokedAt: null,
            },
          })
        : await transaction.serproConnection.create({
            data: {
              id: input.id,
              tenantId: input.tenantId,
              certificateId: input.certificateId,
              contractorCnpj: input.contractorCnpj,
              requesterCnpj: input.requesterCnpj,
              encryptedConsumerKey: input.encryptedConsumerKey,
              encryptedConsumerSecret: input.encryptedConsumerSecret,
              keyVersion: input.keyVersion,
              configuredById: input.actorId,
            },
          });

      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: existing
            ? 'ecac.serpro_connection.updated'
            : 'ecac.serpro_connection.configured',
          entityType: 'serpro_connection',
          entityId: connection.id,
          metadata: {
            certificateId: input.certificateId,
            contractorCnpj: input.contractorCnpj,
            requesterCnpj: input.requesterCnpj,
            keyVersion: input.keyVersion,
          },
        },
      });

      return toDomain(connection);
    });
  }

  public async find(tenantId: string): Promise<SerproConnection | null> {
    const connection = await this.prisma.serproConnection.findUnique({
      where: { tenantId },
    });
    return connection ? toDomain(connection) : null;
  }

  public async getMaterialForUse(
    tenantId: string,
    certificateId: string,
    now: Date,
  ): Promise<SerproConnectionMaterial | null> {
    const connection = await this.prisma.serproConnection.findFirst({
      where: {
        tenantId,
        certificateId,
        status: 'ACTIVE',
        certificate: {
          status: 'ACTIVE',
          validFrom: { lte: now },
          validUntil: { gt: now },
        },
      },
      include: { certificate: true },
    });
    if (!connection) {
      return null;
    }

    return {
      id: connection.id,
      tenantId: connection.tenantId,
      certificateId: connection.certificateId,
      contractorCnpj: connection.contractorCnpj,
      requesterCnpj: connection.requesterCnpj,
      encryptedConsumerKey: connection.encryptedConsumerKey,
      encryptedConsumerSecret: connection.encryptedConsumerSecret,
      connectionKeyVersion: connection.keyVersion,
      connectionUpdatedAt: connection.updatedAt,
      encryptedCertificateBundle: connection.certificate.encryptedBundle,
      encryptedCertificatePassword: connection.certificate.encryptedPassword,
      certificateKeyVersion: connection.certificate.keyVersion,
      certificateFingerprintSha256:
        connection.certificate.fingerprintSha256,
    };
  }

  public async getEncryptedForRotation(
    tenantId: string,
    targetKeyVersion: number,
  ): Promise<EncryptedSerproConnectionMaterial | null> {
    return this.prisma.serproConnection.findFirst({
      where: {
        tenantId,
        keyVersion: { not: targetKeyVersion },
      },
      select: {
        id: true,
        encryptedConsumerKey: true,
        encryptedConsumerSecret: true,
        keyVersion: true,
      },
    });
  }

  public async rotateEncryptionWithAudit(
    input: RotateSerproConnectionEncryptionInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.count({
        where: {
          tenantId: input.tenantId,
          userId: input.actorId,
          status: 'ACTIVE',
        },
      });
      if (membership !== 1) {
        throw new NotFoundError(
          'Vínculo ativo não encontrado.',
          'MEMBERSHIP_NOT_FOUND',
        );
      }

      const update = await transaction.serproConnection.updateMany({
        where: {
          id: input.connectionId,
          tenantId: input.tenantId,
          keyVersion: input.expectedKeyVersion,
        },
        data: {
          encryptedConsumerKey: input.encryptedConsumerKey,
          encryptedConsumerSecret: input.encryptedConsumerSecret,
          keyVersion: input.targetKeyVersion,
        },
      });
      if (update.count === 0) {
        return false;
      }

      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: 'ecac.serpro_connection.key_rotated',
          entityType: 'serpro_connection',
          entityId: input.connectionId,
          metadata: {
            previousKeyVersion: input.expectedKeyVersion,
            targetKeyVersion: input.targetKeyVersion,
          },
        },
      });
      return true;
    });
  }

  public async recordUseWithAudit(
    input: RecordSerproUseInput,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: null,
        action: {
          AUTHENTICATE: 'ecac.serpro.authenticated',
          QUERY: 'ecac.serpro.queried',
          SITFIS_REQUEST: 'ecac.serpro.sitfis_protocol_requested',
          SITFIS_EMIT: 'ecac.serpro.sitfis_report_requested',
        }[input.operation],
        entityType: 'serpro_connection',
        entityId: input.connectionId,
        metadata: {
          companyId: input.companyId,
          queryType: input.queryType,
          operation: input.operation,
          outcome: input.outcome,
          ...(input.providerStatus === undefined
            ? {}
            : { providerStatus: input.providerStatus }),
          occurredAt: input.occurredAt.toISOString(),
        },
      },
    });
  }
}
