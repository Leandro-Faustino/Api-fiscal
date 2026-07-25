import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../../../shared/domain/app-error.js';
import type { CredentialAuthorityRepository } from '../ports/credential-authority-repository.js';
import type {
  CompanyResponsible,
  CompanyResponsibleRole,
} from '../../domain/credential-authority.js';

interface Dependencies {
  credentialAuthorityRepository: CredentialAuthorityRepository;
}

export interface AssignCompanyResponsibleCommand {
  tenantId: string;
  companyId: string;
  membershipId: string;
  role: CompanyResponsibleRole;
  actorId: string;
}

export class AssignCompanyResponsibleUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public async execute(
    command: AssignCompanyResponsibleCommand,
  ): Promise<CompanyResponsible> {
    if (!['PRIMARY', 'SUPPORT'].includes(command.role)) {
      throw new ValidationError('Papel de responsável inválido.');
    }

    return this.repository.assignResponsibleWithAudit({
      id: randomUUID(),
      ...command,
    });
  }
}
