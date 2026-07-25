import { describe, expect, it } from 'vitest';
import type {
  AssignCompanyResponsibleInput,
  CreatePowerOfAttorneyInput,
  CredentialAuthorityRepository,
  ExpirationAlertCandidate,
} from '../application/ports/credential-authority-repository.js';
import { CreatePowerOfAttorneyUseCase } from '../application/use-cases/create-power-of-attorney.js';
import {
  buildExpirationCandidate,
  ScanCredentialExpirationAlertsUseCase,
} from '../application/use-cases/manage-credential-alerts.js';
import type {
  CompanyResponsible,
  CredentialAlert,
  CredentialAlertStatus,
  ExpirationSource,
  PowerOfAttorney,
} from '../domain/credential-authority.js';

class FakeAuthorityRepository implements CredentialAuthorityRepository {
  public powerInput: CreatePowerOfAttorneyInput | null = null;
  public expirationSources: ExpirationSource[] = [];
  public alertCandidates: ExpirationAlertCandidate[] = [];

  public async createPowerOfAttorneyWithAudit(
    input: CreatePowerOfAttorneyInput,
  ): Promise<PowerOfAttorney> {
    this.powerInput = input;
    return {
      id: input.id,
      tenantId: input.tenantId,
      companyId: input.companyId,
      responsibleId: input.responsibleId,
      certificateId: input.certificateId,
      label: input.label,
      externalReference: input.externalReference,
      services: input.services,
      status: 'ACTIVE',
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      createdById: input.actorId,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  public async listExpirationSources(): Promise<ExpirationSource[]> {
    return this.expirationSources;
  }

  public async createExpirationAlertsWithAudit(
    _tenantId: string,
    _actorId: string,
    candidates: ExpirationAlertCandidate[],
  ): Promise<number> {
    this.alertCandidates = candidates;
    return candidates.length;
  }

  public async assignResponsibleWithAudit(
    _input: AssignCompanyResponsibleInput,
  ): Promise<CompanyResponsible> {
    throw new Error('Não usado neste teste.');
  }

  public async listResponsibles(): Promise<CompanyResponsible[]> {
    return [];
  }

  public async deactivateResponsibleWithAudit(): Promise<CompanyResponsible> {
    throw new Error('Não usado neste teste.');
  }

  public async listPowersOfAttorney(): Promise<PowerOfAttorney[]> {
    return [];
  }

  public async revokePowerOfAttorneyWithAudit(): Promise<PowerOfAttorney> {
    throw new Error('Não usado neste teste.');
  }

  public async listAlerts(
    _tenantId: string,
    _status?: CredentialAlertStatus,
  ): Promise<CredentialAlert[]> {
    return [];
  }

  public async acknowledgeAlertWithAudit(): Promise<CredentialAlert> {
    throw new Error('Não usado neste teste.');
  }
}

const baseCommand = {
  tenantId: '30000000-0000-4000-8000-000000000001',
  actorId: '10000000-0000-4000-8000-000000000001',
  companyId: '40000000-0000-4000-8000-000000000001',
  responsibleId: '60000000-0000-4000-8000-000000000001',
  certificateId: null,
  label: '  Procuração e-CAC  ',
  externalReference: '  protocolo-123  ',
  services: [' ecac ', 'DCTFWEB', 'ecac'],
  validFrom: new Date('2026-07-01T00:00:00.000Z'),
  validUntil: new Date('2027-07-01T00:00:00.000Z'),
};

describe('procurações e alertas do cofre', () => {
  it('normaliza serviços e referência ao cadastrar uma procuração', async () => {
    const repository = new FakeAuthorityRepository();
    const useCase = new CreatePowerOfAttorneyUseCase({
      credentialAuthorityRepository: repository,
    });

    const result = await useCase.execute(baseCommand);

    expect(result).toMatchObject({
      label: 'Procuração e-CAC',
      externalReference: 'protocolo-123',
      services: ['ECAC', 'DCTFWEB'],
      lifecycle: 'ACTIVE',
    });
    expect(repository.powerInput?.services).toEqual(['ECAC', 'DCTFWEB']);
  });

  it('rejeita período invertido e código de serviço inválido', async () => {
    const useCase = new CreatePowerOfAttorneyUseCase({
      credentialAuthorityRepository: new FakeAuthorityRepository(),
    });

    await expect(
      useCase.execute({
        ...baseCommand,
        validUntil: baseCommand.validFrom,
      }),
    ).rejects.toThrow('data final');
    await expect(
      useCase.execute({
        ...baseCommand,
        services: ['x'],
      }),
    ).rejects.toThrow('serviços distintos');
  });

  it('seleciona o marco de alerta mais próximo sem criar alertas fora de 30 dias', () => {
    const now = new Date('2026-07-25T12:00:00.000Z');
    const source = {
      sourceType: 'CERTIFICATE' as const,
      sourceId: '50000000-0000-4000-8000-000000000001',
      sourceLabel: 'A1 principal',
    };

    expect(
      buildExpirationCandidate(
        { ...source, dueAt: new Date('2026-08-03T12:00:00.000Z') },
        now,
      ),
    ).toMatchObject({ kind: 'EXPIRING', thresholdDays: 15 });
    expect(
      buildExpirationCandidate(
        { ...source, dueAt: new Date('2026-07-24T12:00:00.000Z') },
        now,
      ),
    ).toMatchObject({ kind: 'EXPIRED', thresholdDays: 0 });
    expect(
      buildExpirationCandidate(
        { ...source, dueAt: new Date('2026-09-01T12:00:00.000Z') },
        now,
      ),
    ).toBeNull();
  });

  it('varre certificados e procurações usando candidatos deduplicáveis', async () => {
    const repository = new FakeAuthorityRepository();
    repository.expirationSources = [
      {
        sourceType: 'CERTIFICATE',
        sourceId: '50000000-0000-4000-8000-000000000001',
        sourceLabel: 'A1 principal',
        dueAt: new Date('2026-08-24T12:00:00.000Z'),
      },
      {
        sourceType: 'POWER_OF_ATTORNEY',
        sourceId: '70000000-0000-4000-8000-000000000001',
        sourceLabel: 'Procuração e-CAC',
        dueAt: new Date('2026-07-26T12:00:00.000Z'),
      },
    ];
    const useCase = new ScanCredentialExpirationAlertsUseCase({
      credentialAuthorityRepository: repository,
    });

    await expect(
      useCase.execute(
        baseCommand.tenantId,
        baseCommand.actorId,
        new Date('2026-07-25T12:00:00.000Z'),
      ),
    ).resolves.toEqual({ scanned: 2, created: 2 });
    expect(repository.alertCandidates).toEqual([
      expect.objectContaining({ sourceType: 'CERTIFICATE', thresholdDays: 30 }),
      expect.objectContaining({
        sourceType: 'POWER_OF_ATTORNEY',
        thresholdDays: 1,
      }),
    ]);
  });
});
