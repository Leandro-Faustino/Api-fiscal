import type { CertificateInspection } from '../../domain/digital-certificate.js';

export interface CertificateInspector {
  inspect(bundle: Buffer, password: string): CertificateInspection;
}
