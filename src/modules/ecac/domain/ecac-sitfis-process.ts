export type EcacSitfisStatus =
  | 'AWAITING_PROTOCOL'
  | 'AWAITING_REPORT'
  | 'COMPLETED';

export interface EcacSitfisProcess {
  id: string;
  tenantId: string;
  jobId: string;
  companyId: string;
  status: EcacSitfisStatus;
  encryptedProtocol: string | null;
  protocolKeyVersion: number | null;
  protocolHash: string | null;
  nextAttemptAt: Date | null;
  providerStatus: number | null;
  reportHash: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
