export type SerproConnectionStatus = 'ACTIVE' | 'REVOKED';

export interface SerproConnection {
  id: string;
  tenantId: string;
  certificateId: string;
  contractorCnpj: string;
  requesterCnpj: string;
  status: SerproConnectionStatus;
  configuredById: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
