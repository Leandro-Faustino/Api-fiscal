import type { CompanyRegistrationStatus } from '../../domain/company.js';

export interface CompanyRegistryData {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: CompanyRegistrationStatus;
  openingDate: Date | null;
  primaryCnae: string | null;
  primaryCnaeDescription: string | null;
  municipality: string | null;
  state: string | null;
  source: 'BRASIL_API';
  consultedAt: Date;
}

export interface CompanyRegistryGateway {
  lookup(cnpj: string): Promise<CompanyRegistryData>;
}
