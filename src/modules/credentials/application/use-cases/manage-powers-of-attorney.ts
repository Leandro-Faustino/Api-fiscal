import type { CredentialAuthorityRepository } from '../ports/credential-authority-repository.js';
import {
  withPowerOfAttorneyLifecycle,
  type PowerOfAttorneyView,
} from '../../domain/credential-authority.js';

interface Dependencies {
  credentialAuthorityRepository: CredentialAuthorityRepository;
}

export class ListPowersOfAttorneyUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public async execute(
    tenantId: string,
    companyId?: string,
  ): Promise<PowerOfAttorneyView[]> {
    const powersOfAttorney = await this.repository.listPowersOfAttorney(
      tenantId,
      companyId,
    );
    return powersOfAttorney.map((item) => withPowerOfAttorneyLifecycle(item));
  }
}

export class RevokePowerOfAttorneyUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public async execute(
    tenantId: string,
    powerOfAttorneyId: string,
    actorId: string,
  ): Promise<PowerOfAttorneyView> {
    const powerOfAttorney = await this.repository.revokePowerOfAttorneyWithAudit(
      tenantId,
      powerOfAttorneyId,
      actorId,
      new Date(),
    );
    return withPowerOfAttorneyLifecycle(powerOfAttorney);
  }
}
