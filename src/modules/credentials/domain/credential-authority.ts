export type CompanyResponsibleRole = 'PRIMARY' | 'SUPPORT';
export type CompanyResponsibleStatus = 'ACTIVE' | 'INACTIVE';

export interface CompanyResponsible {
  id: string;
  tenantId: string;
  companyId: string;
  membershipId: string;
  role: CompanyResponsibleRole;
  status: CompanyResponsibleStatus;
  assignedById: string;
  memberName: string;
  memberEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PowerOfAttorneyStatus = 'ACTIVE' | 'REVOKED';
export type PowerOfAttorneyLifecycle =
  | PowerOfAttorneyStatus
  | 'EXPIRED'
  | 'NOT_YET_VALID';

export interface PowerOfAttorney {
  id: string;
  tenantId: string;
  companyId: string;
  responsibleId: string;
  certificateId: string | null;
  label: string;
  externalReference: string | null;
  services: string[];
  status: PowerOfAttorneyStatus;
  validFrom: Date;
  validUntil: Date;
  createdById: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PowerOfAttorneyView extends PowerOfAttorney {
  lifecycle: PowerOfAttorneyLifecycle;
}

export function withPowerOfAttorneyLifecycle(
  powerOfAttorney: PowerOfAttorney,
  now = new Date(),
): PowerOfAttorneyView {
  let lifecycle: PowerOfAttorneyLifecycle = powerOfAttorney.status;

  if (powerOfAttorney.status !== 'REVOKED') {
    if (powerOfAttorney.validFrom.getTime() > now.getTime()) {
      lifecycle = 'NOT_YET_VALID';
    } else if (powerOfAttorney.validUntil.getTime() <= now.getTime()) {
      lifecycle = 'EXPIRED';
    }
  }

  return { ...powerOfAttorney, lifecycle };
}

export type CredentialAlertKind = 'EXPIRING' | 'EXPIRED';
export type CredentialAlertStatus = 'OPEN' | 'ACKNOWLEDGED';
export type CredentialAlertSourceType = 'CERTIFICATE' | 'POWER_OF_ATTORNEY';

export interface CredentialAlert {
  id: string;
  tenantId: string;
  sourceType: CredentialAlertSourceType;
  sourceId: string;
  sourceLabel: string;
  kind: CredentialAlertKind;
  status: CredentialAlertStatus;
  thresholdDays: number;
  dueAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpirationSource {
  sourceType: CredentialAlertSourceType;
  sourceId: string;
  sourceLabel: string;
  dueAt: Date;
}
