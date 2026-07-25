import { createHash, randomUUID } from 'node:crypto';
import { ValidationError } from '../../../../shared/domain/app-error.js';
import type {
  EcacRadarRepository,
  EcacSyncTarget,
} from '../ports/ecac-radar-repository.js';
import {
  ecacQueryTypes,
  type EcacQueryType,
  type EcacSyncBatch,
} from '../../domain/ecac-radar.js';

interface Dependencies {
  ecacRadarRepository: EcacRadarRepository;
}

export interface RequestEcacSyncInput {
  tenantId: string;
  actorId: string;
  requestKey: string;
  queryType: EcacQueryType;
  targets: EcacSyncTarget[];
  maxAttempts?: number;
}

function normalizeTargets(targets: EcacSyncTarget[]): EcacSyncTarget[] {
  const unique = new Map<string, EcacSyncTarget>();
  for (const target of targets) {
    const key = `${target.companyId}:${target.powerOfAttorneyId}`;
    unique.set(key, target);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.companyId}:${left.powerOfAttorneyId}`.localeCompare(
      `${right.companyId}:${right.powerOfAttorneyId}`,
    ),
  );
}

export class RequestEcacSyncUseCase {
  private readonly repository: EcacRadarRepository;

  public constructor({ ecacRadarRepository }: Dependencies) {
    this.repository = ecacRadarRepository;
  }

  public async execute(input: RequestEcacSyncInput): Promise<EcacSyncBatch> {
    const requestKey = input.requestKey.trim();
    if (requestKey.length < 8 || requestKey.length > 128) {
      throw new ValidationError('A chave idempotente deve possuir entre 8 e 128 caracteres.');
    }
    if (!ecacQueryTypes.includes(input.queryType)) {
      throw new ValidationError('Tipo de consulta e-CAC inválido.');
    }
    if (input.targets.length === 0 || input.targets.length > 100) {
      throw new ValidationError('Informe de 1 a 100 empresas por lote.');
    }

    const targets = normalizeTargets(input.targets);
    if (targets.length !== input.targets.length) {
      throw new ValidationError('O lote contém empresas ou procurações duplicadas.');
    }

    const maxAttempts = input.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new ValidationError('maxAttempts deve ser um inteiro entre 1 e 10.');
    }

    const targetHash = createHash('sha256')
      .update(
        JSON.stringify({
          queryType: input.queryType,
          targets,
          maxAttempts,
        }),
      )
      .digest('hex');

    return this.repository.createBatchWithAudit({
      id: randomUUID(),
      tenantId: input.tenantId,
      requestKey,
      targetHash,
      queryType: input.queryType,
      requestedById: input.actorId,
      maxAttempts,
      targets,
      now: new Date(),
    });
  }
}
