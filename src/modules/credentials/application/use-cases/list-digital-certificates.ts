import type { DigitalCertificateRepository } from '../ports/digital-certificate-repository.js';
import {
  withCertificateLifecycle,
  type DigitalCertificateView,
} from '../../domain/digital-certificate.js';

interface Dependencies {
  digitalCertificateRepository: DigitalCertificateRepository;
}

export class ListDigitalCertificatesUseCase {
  private readonly repository: DigitalCertificateRepository;

  public constructor({ digitalCertificateRepository }: Dependencies) {
    this.repository = digitalCertificateRepository;
  }

  public async execute(tenantId: string): Promise<DigitalCertificateView[]> {
    return (await this.repository.list(tenantId)).map((certificate) =>
      withCertificateLifecycle(certificate),
    );
  }
}
