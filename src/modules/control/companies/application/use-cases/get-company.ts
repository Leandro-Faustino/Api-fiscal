import { NotFoundError } from '../../../../../shared/domain/app-error.js';
import type { Company } from '../../domain/company.js';
import type { CompanyRepository } from '../ports/company-repository.js';

interface Dependencies {
  companyRepository: CompanyRepository;
}

export class GetCompanyUseCase {
  private readonly companyRepository: CompanyRepository;

  public constructor({ companyRepository }: Dependencies) {
    this.companyRepository = companyRepository;
  }

  public async execute(tenantId: string, companyId: string): Promise<Company> {
    const company = await this.companyRepository.findById(tenantId, companyId);

    if (!company) {
      throw new NotFoundError('Empresa não encontrada.', 'COMPANY_NOT_FOUND');
    }

    return company;
  }
}
