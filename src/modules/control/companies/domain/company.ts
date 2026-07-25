export type CompanyRegistrationStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'CLOSED' | 'UNKNOWN';

export type CompanyDataSource = 'BRASIL_API' | 'MANUAL';

export interface Company {
  id: string;
  tenantId: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: CompanyRegistrationStatus;
  openingDate: Date | null;
  primaryCnae: string | null;
  primaryCnaeDescription: string | null;
  municipality: string | null;
  state: string | null;
  dataSource: CompanyDataSource;
  registryUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
