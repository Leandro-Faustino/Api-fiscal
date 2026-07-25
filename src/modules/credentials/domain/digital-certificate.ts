export type DigitalCertificateKind = 'A1';
export type DigitalCertificateStatus = 'ACTIVE' | 'REVOKED';
export type DigitalCertificateLifecycle =
  | DigitalCertificateStatus
  | 'EXPIRED'
  | 'NOT_YET_VALID';

export interface DigitalCertificate {
  id: string;
  tenantId: string;
  label: string;
  kind: DigitalCertificateKind;
  status: DigitalCertificateStatus;
  fingerprintSha256: string;
  serialNumber: string;
  subjectCommonName: string;
  issuerCommonName: string;
  validFrom: Date;
  validUntil: Date;
  companyIds: string[];
  uploadedById: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DigitalCertificateView extends DigitalCertificate {
  lifecycle: DigitalCertificateLifecycle;
}

export interface CertificateInspection {
  fingerprintSha256: string;
  serialNumber: string;
  subjectCommonName: string;
  issuerCommonName: string;
  validFrom: Date;
  validUntil: Date;
}

export function withCertificateLifecycle(
  certificate: DigitalCertificate,
  now = new Date(),
): DigitalCertificateView {
  let lifecycle: DigitalCertificateLifecycle = certificate.status;

  if (certificate.status !== 'REVOKED') {
    if (certificate.validFrom.getTime() > now.getTime()) {
      lifecycle = 'NOT_YET_VALID';
    } else if (certificate.validUntil.getTime() <= now.getTime()) {
      lifecycle = 'EXPIRED';
    }
  }

  return { ...certificate, lifecycle };
}
