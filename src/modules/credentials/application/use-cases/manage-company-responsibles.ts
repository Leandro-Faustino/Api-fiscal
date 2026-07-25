import type { CredentialAuthorityRepository } from '../ports/credential-authority-repository.js';
import type { CompanyResponsible } from '../../domain/credential-authority.js';

interface Dependencies {
  credentialAuthorityRepository: CredentialAuthorityRepository;
}

export class ListCompanyResponsiblesUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public execute(tenantId: string, companyId: string): Promise<CompanyResponsible[]> {
    return this.repository.listResponsibles(tenantId, companyId);
  }
}

export class DeactivateCompanyResponsibleUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public execute(
    tenantId: string,
    companyId: string,
    responsibleId: string,
    actorId: string,
  ): Promise<CompanyResponsible> {
    return this.repository.deactivateResponsibleWithAudit(
      tenantId,
      companyId,
      responsibleId,
      actorId,
    );
  }
}
