import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/app-error.js';
import type { Company } from '../../domain/company.js';
import type {
  CompanyRepository,
  CreateCompanyInput,
} from '../../application/ports/company-repository.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

export class PrismaCompanyRepository implements CompanyRepository {
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async findByTenantAndCnpj(tenantId: string, cnpj: string): Promise<Company | null> {
    return this.prisma.company.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
  }

  public async findById(tenantId: string, companyId: string): Promise<Company | null> {
    return this.prisma.company.findFirst({
      where: { id: companyId, tenantId },
    });
  }

  public async createWithAudit(input: CreateCompanyInput): Promise<Company> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const company = await transaction.company.create({
          data: {
            tenantId: input.tenantId,
            cnpj: input.registryData.cnpj,
            legalName: input.registryData.legalName,
            tradeName: input.registryData.tradeName,
            registrationStatus: input.registryData.registrationStatus,
            openingDate: input.registryData.openingDate,
            primaryCnae: input.registryData.primaryCnae,
            primaryCnaeDescription: input.registryData.primaryCnaeDescription,
            municipality: input.registryData.municipality,
            state: input.registryData.state,
            dataSource: input.registryData.source,
            registryUpdatedAt: input.registryData.consultedAt,
          },
        });

        await transaction.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorId: input.actorId,
            action: 'company.registered',
            entityType: 'company',
            entityId: company.id,
            metadata: {
              cnpj: company.cnpj,
              dataSource: company.dataSource,
            },
          },
        });

        return company;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          'Este CNPJ já está cadastrado para o escritório.',
          'COMPANY_ALREADY_EXISTS',
        );
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Escritório não encontrado.', 'TENANT_NOT_FOUND');
      }

      throw error;
    }
  }
}
