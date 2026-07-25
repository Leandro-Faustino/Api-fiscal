import type {
  CertificateInspection,
  DigitalCertificate,
} from '../../domain/digital-certificate.js';

export interface CreateDigitalCertificateInput {
  id: string;
  tenantId: string;
  actorId: string;
  label: string;
  encryptedBundle: string;
  encryptedPassword: string;
  keyVersion: number;
  inspection: CertificateInspection;
  companyIds: string[];
}

export interface EncryptedCertificateMaterial {
  id: string;
  tenantId: string;
  encryptedBundle: string;
  encryptedPassword: string;
  keyVersion: number;
}

export interface RotateCertificateEncryptionInput {
  tenantId: string;
  certificateId: string;
  actorId: string;
  expectedKeyVersion: number;
  encryptedBundle: string;
  encryptedPassword: string;
  targetKeyVersion: number;
}

export interface DigitalCertificateRepository {
  createWithAudit(input: CreateDigitalCertificateInput): Promise<DigitalCertificate>;
  findById(tenantId: string, certificateId: string): Promise<DigitalCertificate | null>;
  list(tenantId: string): Promise<DigitalCertificate[]>;
  revokeWithAudit(
    tenantId: string,
    certificateId: string,
    actorId: string,
    revokedAt: Date,
  ): Promise<DigitalCertificate>;
  listEncryptedForRotation(
    tenantId: string,
    targetKeyVersion: number,
    limit: number,
  ): Promise<EncryptedCertificateMaterial[]>;
  rotateEncryptionWithAudit(
    input: RotateCertificateEncryptionInput,
  ): Promise<boolean>;
}
