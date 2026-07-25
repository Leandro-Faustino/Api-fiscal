import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../../../shared/domain/app-error.js';
import type { CredentialAuthorityRepository } from '../ports/credential-authority-repository.js';
import {
  withPowerOfAttorneyLifecycle,
  type PowerOfAttorneyView,
} from '../../domain/credential-authority.js';

interface Dependencies {
  credentialAuthorityRepository: CredentialAuthorityRepository;
}

export interface CreatePowerOfAttorneyCommand {
  tenantId: string;
  companyId: string;
  responsibleId: string;
  certificateId?: string | null;
  label: string;
  externalReference?: string | null;
  services: string[];
  validFrom: Date;
  validUntil: Date;
  actorId: string;
}

const servicePattern = /^[A-Z0-9][A-Z0-9_.:-]{1,79}$/;

export class CreatePowerOfAttorneyUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public async execute(
    command: CreatePowerOfAttorneyCommand,
  ): Promise<PowerOfAttorneyView> {
    const label = command.label.trim();
    const externalReference = command.externalReference?.trim() || null;
    const services = [...new Set(command.services.map((service) => service.trim().toUpperCase()))];
    const validFromTime = command.validFrom.getTime();
    const validUntilTime = command.validUntil.getTime();

    if (label.length < 2 || label.length > 120) {
      throw new ValidationError('O nome da procuração deve ter entre 2 e 120 caracteres.');
    }
    if (externalReference && externalReference.length > 120) {
      throw new ValidationError('A referência externa deve ter no máximo 120 caracteres.');
    }
    if (
      services.length < 1 ||
      services.length > 50 ||
      services.some((service) => !servicePattern.test(service))
    ) {
      throw new ValidationError(
        'Informe de 1 a 50 serviços distintos usando códigos de 2 a 80 caracteres.',
      );
    }
    if (
      Number.isNaN(validFromTime) ||
      Number.isNaN(validUntilTime)
    ) {
      throw new ValidationError('A data final deve ser posterior à data inicial.');
    }
    const validFrom = new Date(
      Date.UTC(
        command.validFrom.getUTCFullYear(),
        command.validFrom.getUTCMonth(),
        command.validFrom.getUTCDate(),
      ),
    );
    const validUntil = new Date(
      Date.UTC(
        command.validUntil.getUTCFullYear(),
        command.validUntil.getUTCMonth(),
        command.validUntil.getUTCDate(),
      ),
    );
    if (validFrom.getTime() >= validUntil.getTime()) {
      throw new ValidationError('A data final deve ser posterior à data inicial.');
    }

    const powerOfAttorney = await this.repository.createPowerOfAttorneyWithAudit({
      id: randomUUID(),
      tenantId: command.tenantId,
      companyId: command.companyId,
      responsibleId: command.responsibleId,
      certificateId: command.certificateId ?? null,
      label,
      externalReference,
      services,
      validFrom,
      validUntil,
      actorId: command.actorId,
    });

    return withPowerOfAttorneyLifecycle(powerOfAttorney);
  }
}
