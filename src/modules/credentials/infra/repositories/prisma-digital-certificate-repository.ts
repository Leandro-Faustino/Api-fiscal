import {
  Prisma,
  type DigitalCertificate as PrismaDigitalCertificate,
  type PrismaClient,
} from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
} from '../../../../shared/domain/app-error.js';
import type { DigitalCertificateRepository } from '../../application/ports/digital-certificate-repository.js';
import type {
  CreateDigitalCertificateInput,
  EncryptedCertificateMaterial,
  RotateCertificateEncryptionInput,
} from '../../application/ports/digital-certificate-repository.js';
import type { DigitalCertificate } from '../../domain/digital-certificate.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

type CertificateRow = PrismaDigitalCertificate & {
  companyScopes: Array<{ companyId: string }>;
};

function toDomain(row: CertificateRow): DigitalCertificate {
  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    kind: row.kind,
    status: row.status,
    fingerprintSha256: row.fingerprintSha256,
    serialNumber: row.serialNumber,
    subjectCommonName: row.subjectCommonName,
    issuerCommonName: row.issuerCommonName,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    companyIds: row.companyScopes.map((scope) => scope.companyId),
    uploadedById: row.uploadedById,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaDigitalCertificateRepository
  implements DigitalCertificateRepository
{
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async createWithAudit(
    input: CreateDigitalCertificateInput,
  ): Promise<DigitalCertificate> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const [actorMembership, scopedCompanies] = await Promise.all([
          transaction.membership.count({
            where: {
              tenantId: input.tenantId,
              userId: input.actorId,
              status: 'ACTIVE',
            },
          }),
          transaction.company.findMany({
            where: {
              tenantId: input.tenantId,
              id: { in: input.companyIds },
            },
            select: { id: true },
          }),
        ]);

        if (actorMembership !== 1) {
          throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
        }

        if (scopedCompanies.length !== input.companyIds.length) {
          throw new NotFoundError(
            'Uma ou mais empresas do escopo não foram encontradas.',
            'CERTIFICATE_SCOPE_COMPANY_NOT_FOUND',
          );
        }

        const certificate = await transaction.digitalCertificate.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            uploadedById: input.actorId,
            label: input.label,
            encryptedBundle: input.encryptedBundle,
            encryptedPassword: input.encryptedPassword,
            keyVersion: input.keyVersion,
            fingerprintSha256: input.inspection.fingerprintSha256,
            serialNumber: input.inspection.serialNumber,
            subjectCommonName: input.inspection.subjectCommonName,
            issuerCommonName: input.inspection.issuerCommonName,
            validFrom: input.inspection.validFrom,
            validUntil: input.inspection.validUntil,
            companyScopes: {
              create: input.companyIds.map((companyId) => ({
                tenantId: input.tenantId,
                companyId,
              })),
            },
          },
          include: {
            companyScopes: { select: { companyId: true } },
          },
        });

        await transaction.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorId: input.actorId,
            action: 'credential.certificate.uploaded',
            entityType: 'digital_certificate',
            entityId: certificate.id,
            metadata: {
              kind: certificate.kind,
              fingerprintSha256: certificate.fingerprintSha256,
              validUntil: certificate.validUntil.toISOString(),
              companyCount: input.companyIds.length,
              keyVersion: certificate.keyVersion,
            },
          },
        });

        return toDomain(certificate);
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'Este certificado já está cadastrado para o escritório.',
          'CERTIFICATE_ALREADY_EXISTS',
        );
      }
      throw error;
    }
  }

  public async findById(
    tenantId: string,
    certificateId: string,
  ): Promise<DigitalCertificate | null> {
    const certificate = await this.prisma.digitalCertificate.findFirst({
      where: { id: certificateId, tenantId },
      include: {
        companyScopes: { select: { companyId: true } },
      },
    });
    return certificate ? toDomain(certificate) : null;
  }

  public async list(tenantId: string): Promise<DigitalCertificate[]> {
    const certificates = await this.prisma.digitalCertificate.findMany({
      where: { tenantId },
      include: {
        companyScopes: { select: { companyId: true } },
      },
      orderBy: [{ validUntil: 'asc' }, { createdAt: 'desc' }],
    });
    return certificates.map(toDomain);
  }

  public async revokeWithAudit(
    tenantId: string,
    certificateId: string,
    actorId: string,
    revokedAt: Date,
  ): Promise<DigitalCertificate> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.digitalCertificate.findFirst({
        where: { id: certificateId, tenantId },
        include: {
          companyScopes: { select: { companyId: true } },
        },
      });

      if (!existing) {
        throw new NotFoundError('Certificado não encontrado.', 'CERTIFICATE_NOT_FOUND');
      }
      if (existing.status === 'REVOKED') {
        return toDomain(existing);
      }

      const certificate = await transaction.digitalCertificate.update({
        where: { id: certificateId },
        data: {
          status: 'REVOKED',
          revokedAt,
        },
        include: {
          companyScopes: { select: { companyId: true } },
        },
      });

      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: 'credential.certificate.revoked',
          entityType: 'digital_certificate',
          entityId: certificate.id,
          metadata: {
            fingerprintSha256: certificate.fingerprintSha256,
            revokedAt: revokedAt.toISOString(),
          },
        },
      });

      return toDomain(certificate);
    });
  }

  public async listEncryptedForRotation(
    tenantId: string,
    targetKeyVersion: number,
    limit: number,
  ): Promise<EncryptedCertificateMaterial[]> {
    return this.prisma.digitalCertificate.findMany({
      where: {
        tenantId,
        keyVersion: { not: targetKeyVersion },
      },
      select: {
        id: true,
        tenantId: true,
        encryptedBundle: true,
        encryptedPassword: true,
        keyVersion: true,
      },
      orderBy: [{ keyVersion: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  public async rotateEncryptionWithAudit(
    input: RotateCertificateEncryptionInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const actorMembership = await transaction.membership.count({
        where: {
          tenantId: input.tenantId,
          userId: input.actorId,
          status: 'ACTIVE',
        },
      });
      if (actorMembership !== 1) {
        throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
      }

      const update = await transaction.digitalCertificate.updateMany({
        where: {
          id: input.certificateId,
          tenantId: input.tenantId,
          keyVersion: input.expectedKeyVersion,
        },
        data: {
          encryptedBundle: input.encryptedBundle,
          encryptedPassword: input.encryptedPassword,
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
          action: 'credential.certificate.key_rotated',
          entityType: 'digital_certificate',
          entityId: input.certificateId,
          metadata: {
            previousKeyVersion: input.expectedKeyVersion,
            targetKeyVersion: input.targetKeyVersion,
          },
        },
      });

      return true;
    });
  }
}
