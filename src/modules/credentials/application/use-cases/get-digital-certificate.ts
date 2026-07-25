import { NotFoundError } from '../../../../shared/domain/app-error.js';
import type { DigitalCertificateRepository } from '../ports/digital-certificate-repository.js';
import {
  withCertificateLifecycle,
  type DigitalCertificateView,
} from '../../domain/digital-certificate.js';

interface Dependencies {
  digitalCertificateRepository: DigitalCertificateRepository;
}

export class GetDigitalCertificateUseCase {
  private readonly repository: DigitalCertificateRepository;

  public constructor({ digitalCertificateRepository }: Dependencies) {
    this.repository = digitalCertificateRepository;
  }

  public async execute(tenantId: string, certificateId: string): Promise<DigitalCertificateView> {
    const certificate = await this.repository.findById(tenantId, certificateId);
    if (!certificate) {
      throw new NotFoundError('Certificado não encontrado.', 'CERTIFICATE_NOT_FOUND');
    }
    return withCertificateLifecycle(certificate);
  }
}
