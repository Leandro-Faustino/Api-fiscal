import { ValidationError } from '../../../../shared/domain/app-error.js';
import type { CredentialAuthorityRepository } from '../ports/credential-authority-repository.js';
import type {
  CredentialAlert,
  CredentialAlertKind,
  CredentialAlertStatus,
  ExpirationSource,
} from '../../domain/credential-authority.js';
import type { ExpirationAlertCandidate } from '../ports/credential-authority-repository.js';

interface Dependencies {
  credentialAuthorityRepository: CredentialAuthorityRepository;
}

const dayMs = 24 * 60 * 60 * 1_000;
const thresholds = [1, 7, 15, 30] as const;

export function buildExpirationCandidate(
  source: ExpirationSource,
  now: Date,
): ExpirationAlertCandidate | null {
  const remainingMs = source.dueAt.getTime() - now.getTime();
  let kind: CredentialAlertKind;
  let thresholdDays: number;

  if (remainingMs <= 0) {
    kind = 'EXPIRED';
    thresholdDays = 0;
  } else {
    const remainingDays = Math.ceil(remainingMs / dayMs);
    const threshold = thresholds.find((value) => remainingDays <= value);
    if (threshold === undefined) {
      return null;
    }
    kind = 'EXPIRING';
    thresholdDays = threshold;
  }

  return {
    ...source,
    kind,
    thresholdDays,
  };
}

export class ScanCredentialExpirationAlertsUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public async execute(
    tenantId: string,
    actorId: string,
    now = new Date(),
  ): Promise<{ scanned: number; created: number }> {
    const horizon = new Date(now.getTime() + 30 * dayMs);
    const sources = await this.repository.listExpirationSources(tenantId, horizon);
    const candidates = sources
      .map((source) => buildExpirationCandidate(source, now))
      .filter((candidate): candidate is ExpirationAlertCandidate => candidate !== null);
    const created = await this.repository.createExpirationAlertsWithAudit(
      tenantId,
      actorId,
      candidates,
    );
    return { scanned: sources.length, created };
  }
}

export class ListCredentialAlertsUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public execute(
    tenantId: string,
    status?: CredentialAlertStatus,
  ): Promise<CredentialAlert[]> {
    if (status && !['OPEN', 'ACKNOWLEDGED'].includes(status)) {
      throw new ValidationError('Status de alerta inválido.');
    }
    return this.repository.listAlerts(tenantId, status);
  }
}

export class AcknowledgeCredentialAlertUseCase {
  private readonly repository: CredentialAuthorityRepository;

  public constructor({ credentialAuthorityRepository }: Dependencies) {
    this.repository = credentialAuthorityRepository;
  }

  public execute(
    tenantId: string,
    alertId: string,
    actorId: string,
  ): Promise<CredentialAlert> {
    return this.repository.acknowledgeAlertWithAudit(
      tenantId,
      alertId,
      actorId,
      new Date(),
    );
  }
}
