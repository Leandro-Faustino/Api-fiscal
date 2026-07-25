import type { DigitalCertificateRepository } from '../ports/digital-certificate-repository.js';
import {
  withCertificateLifecycle,
  type DigitalCertificateView,
} from '../../domain/digital-certificate.js';

interface Dependencies {
  digitalCertificateRepository: DigitalCertificateRepository;
}

export class RevokeDigitalCertificateUseCase {
  private readonly repository: DigitalCertificateRepository;

  public constructor({ digitalCertificateRepository }: Dependencies) {
    this.repository = digitalCertificateRepository;
  }

  public async execute(
    tenantId: string,
    certificateId: string,
    actorId: string,
  ): Promise<DigitalCertificateView> {
    return withCertificateLifecycle(
      await this.repository.revokeWithAudit(tenantId, certificateId, actorId, new Date()),
    );
  }
}
