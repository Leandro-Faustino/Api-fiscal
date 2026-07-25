import {
  Prisma,
  type CompanyResponsible as PrismaCompanyResponsible,
  type CredentialAlert as PrismaCredentialAlert,
  type PowerOfAttorney as PrismaPowerOfAttorney,
  type PrismaClient,
} from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
} from '../../../../shared/domain/app-error.js';
import type {
  AssignCompanyResponsibleInput,
  CreatePowerOfAttorneyInput,
  CredentialAuthorityRepository,
  ExpirationAlertCandidate,
} from '../../application/ports/credential-authority-repository.js';
import type {
  CompanyResponsible,
  CredentialAlert,
  CredentialAlertStatus,
  ExpirationSource,
  PowerOfAttorney,
} from '../../domain/credential-authority.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

type ResponsibleRow = PrismaCompanyResponsible & {
  membership: { user: { name: string; email: string } };
};

type AlertRow = PrismaCredentialAlert & {
  certificate: { label: string } | null;
  powerOfAttorney: { label: string } | null;
};

function toResponsible(row: ResponsibleRow): CompanyResponsible {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    membershipId: row.membershipId,
    role: row.role,
    status: row.status,
    assignedById: row.assignedById,
    memberName: row.membership.user.name,
    memberEmail: row.membership.user.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPowerOfAttorney(row: PrismaPowerOfAttorney): PowerOfAttorney {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    responsibleId: row.responsibleId,
    certificateId: row.certificateId,
    label: row.label,
    externalReference: row.externalReference,
    services: row.services,
    status: row.status,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    createdById: row.createdById,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAlert(row: AlertRow): CredentialAlert {
  const certificateSource = row.certificate !== null;
  const sourceId = certificateSource ? row.certificateId : row.powerOfAttorneyId;
  const sourceLabel = certificateSource
    ? row.certificate?.label
    : row.powerOfAttorney?.label;

  if (!sourceId || !sourceLabel) {
    throw new Error('Alerta de credencial sem origem válida.');
  }

  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceType: certificateSource ? 'CERTIFICATE' : 'POWER_OF_ATTORNEY',
    sourceId,
    sourceLabel,
    kind: row.kind,
    status: row.status,
    thresholdDays: row.thresholdDays,
    dueAt: row.dueAt,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedById: row.acknowledgedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const responsibleInclude = {
  membership: {
    select: {
      user: { select: { name: true, email: true } },
    },
  },
} as const;

const alertInclude = {
  certificate: { select: { label: true } },
  powerOfAttorney: { select: { label: true } },
} as const;

export class PrismaCredentialAuthorityRepository
  implements CredentialAuthorityRepository
{
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async assignResponsibleWithAudit(
    input: AssignCompanyResponsibleInput,
  ): Promise<CompanyResponsible> {
    return this.prisma.$transaction(async (transaction) => {
      const [actorMembership, company, membership] = await Promise.all([
        transaction.membership.count({
          where: {
            tenantId: input.tenantId,
            userId: input.actorId,
            status: 'ACTIVE',
          },
        }),
        transaction.company.findUnique({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.companyId,
            },
          },
          select: { id: true },
        }),
        transaction.membership.findUnique({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.membershipId,
            },
          },
          select: {
            id: true,
            status: true,
            role: true,
          },
        }),
      ]);

      if (actorMembership !== 1) {
        throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
      }
      if (!company) {
        throw new NotFoundError('Empresa não encontrada.', 'COMPANY_NOT_FOUND');
      }
      if (!membership || membership.status !== 'ACTIVE' || membership.role === 'VIEWER') {
        throw new ConflictError(
          'O responsável deve possuir vínculo contábil ativo no escritório.',
          'RESPONSIBLE_MEMBERSHIP_INVALID',
        );
      }

      const responsible = await transaction.companyResponsible.upsert({
        where: {
          tenantId_companyId_membershipId: {
            tenantId: input.tenantId,
            companyId: input.companyId,
            membershipId: input.membershipId,
          },
        },
        create: {
          id: input.id,
          tenantId: input.tenantId,
          companyId: input.companyId,
          membershipId: input.membershipId,
          role: input.role,
          assignedById: input.actorId,
        },
        update: {
          role: input.role,
          status: 'ACTIVE',
          assignedById: input.actorId,
        },
        include: responsibleInclude,
      });

      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: 'credential.responsible.assigned',
          entityType: 'company_responsible',
          entityId: responsible.id,
          metadata: {
            companyId: input.companyId,
            membershipId: input.membershipId,
            role: input.role,
          },
        },
      });

      return toResponsible(responsible);
    });
  }

  public async listResponsibles(
    tenantId: string,
    companyId: string,
  ): Promise<CompanyResponsible[]> {
    const rows = await this.prisma.companyResponsible.findMany({
      where: { tenantId, companyId },
      include: responsibleInclude,
      orderBy: [{ status: 'asc' }, { role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toResponsible);
  }

  public async deactivateResponsibleWithAudit(
    tenantId: string,
    companyId: string,
    responsibleId: string,
    actorId: string,
  ): Promise<CompanyResponsible> {
    return this.prisma.$transaction(async (transaction) => {
      const responsible = await transaction.companyResponsible.findFirst({
        where: { id: responsibleId, tenantId, companyId },
        include: responsibleInclude,
      });
      if (!responsible) {
        throw new NotFoundError(
          'Responsável não encontrado.',
          'COMPANY_RESPONSIBLE_NOT_FOUND',
        );
      }
      if (responsible.status === 'INACTIVE') {
        return toResponsible(responsible);
      }

      const activePowers = await transaction.powerOfAttorney.count({
        where: { tenantId, responsibleId, status: 'ACTIVE' },
      });
      if (activePowers > 0) {
        throw new ConflictError(
          'Revogue ou transfira as procurações ativas antes de desativar o responsável.',
          'RESPONSIBLE_HAS_ACTIVE_AUTHORITIES',
        );
      }

      const updated = await transaction.companyResponsible.update({
        where: { id: responsibleId },
        data: { status: 'INACTIVE' },
        include: responsibleInclude,
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: 'credential.responsible.deactivated',
          entityType: 'company_responsible',
          entityId: responsibleId,
          metadata: { companyId, membershipId: responsible.membershipId },
        },
      });
      return toResponsible(updated);
    });
  }

  public async createPowerOfAttorneyWithAudit(
    input: CreatePowerOfAttorneyInput,
  ): Promise<PowerOfAttorney> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const [actorMembership, company, responsible] = await Promise.all([
          transaction.membership.count({
            where: {
              tenantId: input.tenantId,
              userId: input.actorId,
              status: 'ACTIVE',
            },
          }),
          transaction.company.findUnique({
            where: {
              tenantId_id: {
                tenantId: input.tenantId,
                id: input.companyId,
              },
            },
            select: { id: true },
          }),
          transaction.companyResponsible.findUnique({
            where: {
              tenantId_companyId_id: {
                tenantId: input.tenantId,
                companyId: input.companyId,
                id: input.responsibleId,
              },
            },
            select: {
              id: true,
              status: true,
              membership: { select: { status: true } },
            },
          }),
        ]);

        if (actorMembership !== 1) {
          throw new NotFoundError('Vínculo ativo não encontrado.', 'MEMBERSHIP_NOT_FOUND');
        }
        if (!company) {
          throw new NotFoundError('Empresa não encontrada.', 'COMPANY_NOT_FOUND');
        }
        if (
          !responsible ||
          responsible.status !== 'ACTIVE' ||
          responsible.membership.status !== 'ACTIVE'
        ) {
          throw new ConflictError(
            'A procuração exige um responsável ativo para a empresa.',
            'POWER_OF_ATTORNEY_RESPONSIBLE_INVALID',
          );
        }

        if (input.certificateId) {
          const now = new Date();
          const certificateScope = await transaction.certificateCompanyScope.findFirst({
            where: {
              tenantId: input.tenantId,
              companyId: input.companyId,
              certificateId: input.certificateId,
              certificate: {
                status: 'ACTIVE',
                validFrom: { lte: now },
                validUntil: { gt: now },
              },
            },
            select: { certificateId: true },
          });
          if (!certificateScope) {
            throw new ConflictError(
              'O certificado deve estar ativo e autorizado para a empresa.',
              'POWER_OF_ATTORNEY_CERTIFICATE_SCOPE_INVALID',
            );
          }
        }

        const powerOfAttorney = await transaction.powerOfAttorney.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            companyId: input.companyId,
            responsibleId: input.responsibleId,
            certificateId: input.certificateId,
            label: input.label,
            externalReference: input.externalReference,
            services: input.services,
            validFrom: input.validFrom,
            validUntil: input.validUntil,
            createdById: input.actorId,
          },
        });
        await transaction.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorId: input.actorId,
            action: 'credential.power_of_attorney.created',
            entityType: 'power_of_attorney',
            entityId: powerOfAttorney.id,
            metadata: {
              companyId: input.companyId,
              responsibleId: input.responsibleId,
              certificateId: input.certificateId,
              validUntil: input.validUntil.toISOString(),
              serviceCount: input.services.length,
            },
          },
        });
        return toPowerOfAttorney(powerOfAttorney);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'Já existe uma procuração com essa referência externa no escritório.',
          'POWER_OF_ATTORNEY_REFERENCE_CONFLICT',
        );
      }
      throw error;
    }
  }

  public async listPowersOfAttorney(
    tenantId: string,
    companyId?: string,
  ): Promise<PowerOfAttorney[]> {
    const rows = await this.prisma.powerOfAttorney.findMany({
      where: {
        tenantId,
        ...(companyId ? { companyId } : {}),
      },
      orderBy: [{ status: 'asc' }, { validUntil: 'asc' }],
    });
    return rows.map(toPowerOfAttorney);
  }

  public async revokePowerOfAttorneyWithAudit(
    tenantId: string,
    powerOfAttorneyId: string,
    actorId: string,
    revokedAt: Date,
  ): Promise<PowerOfAttorney> {
    return this.prisma.$transaction(async (transaction) => {
      const powerOfAttorney = await transaction.powerOfAttorney.findFirst({
        where: { id: powerOfAttorneyId, tenantId },
      });
      if (!powerOfAttorney) {
        throw new NotFoundError(
          'Procuração não encontrada.',
          'POWER_OF_ATTORNEY_NOT_FOUND',
        );
      }
      if (powerOfAttorney.status === 'REVOKED') {
        return toPowerOfAttorney(powerOfAttorney);
      }

      const updated = await transaction.powerOfAttorney.update({
        where: { id: powerOfAttorneyId },
        data: { status: 'REVOKED', revokedAt },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: 'credential.power_of_attorney.revoked',
          entityType: 'power_of_attorney',
          entityId: powerOfAttorneyId,
          metadata: { companyId: powerOfAttorney.companyId },
        },
      });
      return toPowerOfAttorney(updated);
    });
  }

  public async listExpirationSources(
    tenantId: string,
    horizon: Date,
  ): Promise<ExpirationSource[]> {
    const [certificates, powersOfAttorney] = await Promise.all([
      this.prisma.digitalCertificate.findMany({
        where: { tenantId, status: 'ACTIVE', validUntil: { lte: horizon } },
        select: { id: true, label: true, validUntil: true },
      }),
      this.prisma.powerOfAttorney.findMany({
        where: { tenantId, status: 'ACTIVE', validUntil: { lte: horizon } },
        select: { id: true, label: true, validUntil: true },
      }),
    ]);

    return [
      ...certificates.map((certificate) => ({
        sourceType: 'CERTIFICATE' as const,
        sourceId: certificate.id,
        sourceLabel: certificate.label,
        dueAt: certificate.validUntil,
      })),
      ...powersOfAttorney.map((powerOfAttorney) => ({
        sourceType: 'POWER_OF_ATTORNEY' as const,
        sourceId: powerOfAttorney.id,
        sourceLabel: powerOfAttorney.label,
        dueAt: powerOfAttorney.validUntil,
      })),
    ];
  }

  public async createExpirationAlertsWithAudit(
    tenantId: string,
    actorId: string,
    candidates: ExpirationAlertCandidate[],
  ): Promise<number> {
    if (candidates.length === 0) {
      return 0;
    }

    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.credentialAlert.createMany({
        data: candidates.map((candidate) => ({
          tenantId,
          certificateId:
            candidate.sourceType === 'CERTIFICATE' ? candidate.sourceId : null,
          powerOfAttorneyId:
            candidate.sourceType === 'POWER_OF_ATTORNEY'
              ? candidate.sourceId
              : null,
          kind: candidate.kind,
          thresholdDays: candidate.thresholdDays,
          dueAt: candidate.dueAt,
        })),
        skipDuplicates: true,
      });

      if (result.count > 0) {
        await transaction.auditLog.create({
          data: {
            tenantId,
            actorId,
            action: 'credential.expiration_alerts.scanned',
            entityType: 'credential_alert_batch',
            entityId: actorId,
            metadata: { scanned: candidates.length, created: result.count },
          },
        });
      }
      return result.count;
    });
  }

  public async listAlerts(
    tenantId: string,
    status?: CredentialAlertStatus,
  ): Promise<CredentialAlert[]> {
    const rows = await this.prisma.credentialAlert.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: alertInclude,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAlert);
  }

  public async acknowledgeAlertWithAudit(
    tenantId: string,
    alertId: string,
    actorId: string,
    acknowledgedAt: Date,
  ): Promise<CredentialAlert> {
    return this.prisma.$transaction(async (transaction) => {
      const alert = await transaction.credentialAlert.findFirst({
        where: { id: alertId, tenantId },
        include: alertInclude,
      });
      if (!alert) {
        throw new NotFoundError('Alerta não encontrado.', 'CREDENTIAL_ALERT_NOT_FOUND');
      }
      if (alert.status === 'ACKNOWLEDGED') {
        return toAlert(alert);
      }

      const updated = await transaction.credentialAlert.update({
        where: { id: alertId },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt,
          acknowledgedById: actorId,
        },
        include: alertInclude,
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: 'credential.expiration_alert.acknowledged',
          entityType: 'credential_alert',
          entityId: alertId,
          metadata: {
            certificateId: alert.certificateId,
            powerOfAttorneyId: alert.powerOfAttorneyId,
          },
        },
      });
      return toAlert(updated);
    });
  }
}
