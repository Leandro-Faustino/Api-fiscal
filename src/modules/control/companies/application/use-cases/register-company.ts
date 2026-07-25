import { ConflictError } from '../../../../../shared/domain/app-error.js';
import { Cnpj } from '../../domain/cnpj.js';
import type { Company } from '../../domain/company.js';
import type { CompanyRegistryGateway } from '../ports/company-registry-gateway.js';
import type { CompanyRepository } from '../ports/company-repository.js';

interface Dependencies {
  companyRepository: CompanyRepository;
  companyRegistryGateway: CompanyRegistryGateway;
}

export interface RegisterCompanyInput {
  tenantId: string;
  cnpj: string;
  actorId?: string | null;
}

export class RegisterCompanyUseCase {
  private readonly companyRepository: CompanyRepository;
  private readonly companyRegistryGateway: CompanyRegistryGateway;

  public constructor({ companyRepository, companyRegistryGateway }: Dependencies) {
    this.companyRepository = companyRepository;
    this.companyRegistryGateway = companyRegistryGateway;
  }

  public async execute(input: RegisterCompanyInput): Promise<Company> {
    const cnpj = Cnpj.create(input.cnpj);
    const existingCompany = await this.companyRepository.findByTenantAndCnpj(input.tenantId, cnpj.value);

    if (existingCompany) {
      throw new ConflictError(
        'Este CNPJ já está cadastrado para o escritório.',
        'COMPANY_ALREADY_EXISTS',
      );
    }

    const registryData = await this.companyRegistryGateway.lookup(cnpj.value);

    return this.companyRepository.createWithAudit({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      registryData,
    });
  }
}
