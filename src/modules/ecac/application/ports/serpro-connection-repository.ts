import type { EcacQueryType } from '../../domain/ecac-radar.js';
import type { SerproConnection } from '../../domain/serpro-connection.js';

export interface ConfigureSerproConnectionInput {
  id: string;
  tenantId: string;
  certificateId: string;
  contractorCnpj: string;
  requesterCnpj: string;
  encryptedConsumerKey: string;
  encryptedConsumerSecret: string;
  keyVersion: number;
  actorId: string;
  configuredAt: Date;
}

export interface SerproConnectionMaterial {
  id: string;
  tenantId: string;
  certificateId: string;
  contractorCnpj: string;
  requesterCnpj: string;
  encryptedConsumerKey: string;
  encryptedConsumerSecret: string;
  connectionKeyVersion: number;
  connectionUpdatedAt: Date;
  encryptedCertificateBundle: string;
  encryptedCertificatePassword: string;
  certificateKeyVersion: number;
  certificateFingerprintSha256: string;
}

export interface EncryptedSerproConnectionMaterial {
  id: string;
  encryptedConsumerKey: string;
  encryptedConsumerSecret: string;
  keyVersion: number;
}

export interface RotateSerproConnectionEncryptionInput {
  tenantId: string;
  connectionId: string;
  actorId: string;
  expectedKeyVersion: number;
  encryptedConsumerKey: string;
  encryptedConsumerSecret: string;
  targetKeyVersion: number;
}

export interface RecordSerproUseInput {
  tenantId: string;
  connectionId: string;
  companyId: string;
  queryType: EcacQueryType;
  operation: 'AUTHENTICATE' | 'QUERY';
  outcome: 'SUCCEEDED' | 'FAILED';
  providerStatus?: number;
  occurredAt: Date;
}

export interface SerproConnectionRepository {
  configureWithAudit(
    input: ConfigureSerproConnectionInput,
  ): Promise<SerproConnection>;
  find(tenantId: string): Promise<SerproConnection | null>;
  getMaterialForUse(
    tenantId: string,
    certificateId: string,
    now: Date,
  ): Promise<SerproConnectionMaterial | null>;
  getEncryptedForRotation(
    tenantId: string,
    targetKeyVersion: number,
  ): Promise<EncryptedSerproConnectionMaterial | null>;
  rotateEncryptionWithAudit(
    input: RotateSerproConnectionEncryptionInput,
  ): Promise<boolean>;
  recordUseWithAudit(input: RecordSerproUseInput): Promise<void>;
}
