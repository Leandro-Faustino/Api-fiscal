import type { Company } from '../../domain/company.js';
import type { CompanyRegistryData } from './company-registry-gateway.js';

export interface CreateCompanyInput {
  tenantId: string;
  actorId: string | null;
  registryData: CompanyRegistryData;
}

export interface CompanyRepository {
  findByTenantAndCnpj(tenantId: string, cnpj: string): Promise<Company | null>;
  findById(tenantId: string, companyId: string): Promise<Company | null>;
  createWithAudit(input: CreateCompanyInput): Promise<Company>;
}
