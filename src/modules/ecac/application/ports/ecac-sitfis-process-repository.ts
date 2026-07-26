import type {
  EcacSitfisProcess,
  EcacSitfisStatus,
} from '../../domain/ecac-sitfis-process.js';

export interface SaveSitfisCheckpointInput {
  id: string;
  tenantId: string;
  jobId: string;
  lockToken: string;
  companyId: string;
  status: Exclude<EcacSitfisStatus, 'COMPLETED'>;
  encryptedProtocol: string | null;
  protocolKeyVersion: number | null;
  protocolHash: string | null;
  nextAttemptAt: Date;
  providerStatus: number;
  occurredAt: Date;
}

export interface ResetSitfisProtocolInput {
  tenantId: string;
  jobId: string;
  lockToken: string;
  nextAttemptAt: Date;
  providerStatus: number;
  occurredAt: Date;
}

export interface EncryptedSitfisProtocol {
  id: string;
  jobId: string;
  encryptedProtocol: string;
  protocolKeyVersion: number;
}

export interface RotateSitfisProtocolInput {
  tenantId: string;
  processId: string;
  jobId: string;
  actorId: string;
  expectedKeyVersion: number;
  encryptedProtocol: string;
  targetKeyVersion: number;
}

export interface EcacSitfisProcessRepository {
  find(tenantId: string, jobId: string): Promise<EcacSitfisProcess | null>;
  saveCheckpointWithAudit(input: SaveSitfisCheckpointInput): Promise<void>;
  resetProtocolWithAudit(input: ResetSitfisProtocolInput): Promise<void>;
  listEncryptedForRotation(
    tenantId: string,
    targetKeyVersion: number,
    limit: number,
  ): Promise<EncryptedSitfisProtocol[]>;
  rotateEncryptionWithAudit(
    input: RotateSitfisProtocolInput,
  ): Promise<boolean>;
}
