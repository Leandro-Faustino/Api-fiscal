import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../shared/domain/app-error.js';
import type { CompanyRegistryGateway } from '../application/ports/company-registry-gateway.js';
import type {
  CompanyRepository,
  CreateCompanyInput,
} from '../application/ports/company-repository.js';
import { RegisterCompanyUseCase } from '../application/use-cases/register-company.js';
import type { Company } from '../domain/company.js';

class InMemoryCompanyRepository implements CompanyRepository {
  public companies: Company[] = [];

  public async findByTenantAndCnpj(tenantId: string, cnpj: string): Promise<Company | null> {
    return this.companies.find((company) => company.tenantId === tenantId && company.cnpj === cnpj) ?? null;
  }

  public async findById(tenantId: string, companyId: string): Promise<Company | null> {
    return this.companies.find((company) => company.tenantId === tenantId && company.id === companyId) ?? null;
  }

  public async createWithAudit(input: CreateCompanyInput): Promise<Company> {
    const now = new Date('2026-07-25T12:00:00.000Z');
    const company: Company = {
      id: '10000000-0000-4000-8000-000000000001',
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
      createdAt: now,
      updatedAt: now,
    };

    this.companies.push(company);
    return company;
  }
}

class StubCompanyRegistryGateway implements CompanyRegistryGateway {
  public async lookup(cnpj: string) {
    return {
      cnpj,
      legalName: 'EMPRESA EXEMPLO LTDA',
      tradeName: 'EMPRESA EXEMPLO',
      registrationStatus: 'ACTIVE' as const,
      openingDate: new Date('2020-01-10T00:00:00.000Z'),
      primaryCnae: '6201501',
      primaryCnaeDescription: 'Desenvolvimento de programas de computador sob encomenda',
      municipality: 'JOINVILLE',
      state: 'SC',
      source: 'BRASIL_API' as const,
      consultedAt: new Date('2026-07-25T12:00:00.000Z'),
    };
  }
}

describe('RegisterCompanyUseCase', () => {
  let repository: InMemoryCompanyRepository;
  let useCase: RegisterCompanyUseCase;

  beforeEach(() => {
    repository = new InMemoryCompanyRepository();
    useCase = new RegisterCompanyUseCase({
      companyRepository: repository,
      companyRegistryGateway: new StubCompanyRegistryGateway(),
    });
  });

  it('consulta o cadastro público e registra a empresa no escritório', async () => {
    const company = await useCase.execute({
      tenantId: '00000000-0000-4000-8000-000000000001',
      cnpj: '11.222.333/0001-81',
    });

    expect(company).toMatchObject({
      cnpj: '11222333000181',
      legalName: 'EMPRESA EXEMPLO LTDA',
      registrationStatus: 'ACTIVE',
      dataSource: 'BRASIL_API',
    });
    expect(repository.companies).toHaveLength(1);
  });

  it('não permite CNPJ duplicado dentro do mesmo escritório', async () => {
    const input = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      cnpj: '11222333000181',
    };

    await useCase.execute(input);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(repository.companies).toHaveLength(1);
  });

  it('permite o mesmo CNPJ em escritórios diferentes', async () => {
    await useCase.execute({
      tenantId: '00000000-0000-4000-8000-000000000001',
      cnpj: '11222333000181',
    });
    await useCase.execute({
      tenantId: '00000000-0000-4000-8000-000000000002',
      cnpj: '11222333000181',
    });

    expect(repository.companies).toHaveLength(2);
  });
});
