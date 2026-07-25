import type {
  CompanyResponsible,
  CompanyResponsibleRole,
  CredentialAlert,
  CredentialAlertKind,
  CredentialAlertStatus,
  ExpirationSource,
  PowerOfAttorney,
} from '../../domain/credential-authority.js';

export interface AssignCompanyResponsibleInput {
  id: string;
  tenantId: string;
  companyId: string;
  membershipId: string;
  role: CompanyResponsibleRole;
  actorId: string;
}

export interface CreatePowerOfAttorneyInput {
  id: string;
  tenantId: string;
  companyId: string;
  responsibleId: string;
  certificateId: string | null;
  label: string;
  externalReference: string | null;
  services: string[];
  validFrom: Date;
  validUntil: Date;
  actorId: string;
}

export interface ExpirationAlertCandidate {
  sourceType: 'CERTIFICATE' | 'POWER_OF_ATTORNEY';
  sourceId: string;
  sourceLabel: string;
  kind: CredentialAlertKind;
  thresholdDays: number;
  dueAt: Date;
}

export interface CredentialAuthorityRepository {
  assignResponsibleWithAudit(
    input: AssignCompanyResponsibleInput,
  ): Promise<CompanyResponsible>;
  listResponsibles(
    tenantId: string,
    companyId: string,
  ): Promise<CompanyResponsible[]>;
  deactivateResponsibleWithAudit(
    tenantId: string,
    companyId: string,
    responsibleId: string,
    actorId: string,
  ): Promise<CompanyResponsible>;
  createPowerOfAttorneyWithAudit(
    input: CreatePowerOfAttorneyInput,
  ): Promise<PowerOfAttorney>;
  listPowersOfAttorney(
    tenantId: string,
    companyId?: string,
  ): Promise<PowerOfAttorney[]>;
  revokePowerOfAttorneyWithAudit(
    tenantId: string,
    powerOfAttorneyId: string,
    actorId: string,
    revokedAt: Date,
  ): Promise<PowerOfAttorney>;
  listExpirationSources(tenantId: string, horizon: Date): Promise<ExpirationSource[]>;
  createExpirationAlertsWithAudit(
    tenantId: string,
    actorId: string,
    candidates: ExpirationAlertCandidate[],
  ): Promise<number>;
  listAlerts(
    tenantId: string,
    status?: CredentialAlertStatus,
  ): Promise<CredentialAlert[]>;
  acknowledgeAlertWithAudit(
    tenantId: string,
    alertId: string,
    actorId: string,
    acknowledgedAt: Date,
  ): Promise<CredentialAlert>;
}
