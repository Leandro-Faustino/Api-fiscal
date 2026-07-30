import {
  NotFoundError,
  ValidationError,
} from '../../../../shared/domain/app-error.js';
import type { EcacRadarRepository } from '../ports/ecac-radar-repository.js';
import type {
  EcacAlert,
  EcacAlertStatus,
  EcacFinding,
  EcacFindingSeverity,
  EcacSyncBatch,
  EcacSyncBatchStatus,
} from '../../domain/ecac-radar.js';
import type { ListEcacAlertsFilter } from '../ports/ecac-radar-repository.js';

interface Dependencies {
  ecacRadarRepository: EcacRadarRepository;
}

export class GetEcacSyncBatchUseCase {
  private readonly repository: EcacRadarRepository;

  public constructor({ ecacRadarRepository }: Dependencies) {
    this.repository = ecacRadarRepository;
  }

  public async execute(tenantId: string, batchId: string): Promise<EcacSyncBatch> {
    const batch = await this.repository.getBatch(tenantId, batchId);
    if (!batch) {
      throw new NotFoundError('Lote e-CAC não encontrado.', 'ECAC_BATCH_NOT_FOUND');
    }
    return batch;
  }
}

export class ListEcacSyncBatchesUseCase {
  private readonly repository: EcacRadarRepository;

  public constructor({ ecacRadarRepository }: Dependencies) {
    this.repository = ecacRadarRepository;
  }

  public execute(
    tenantId: string,
    status?: EcacSyncBatchStatus,
    companyId?: string,
  ): Promise<EcacSyncBatch[]> {
    return this.repository.listBatches(tenantId, status, companyId);
  }
}

export class ListEcacFindingsUseCase {
  private readonly repository: EcacRadarRepository;

  public constructor({ ecacRadarRepository }: Dependencies) {
    this.repository = ecacRadarRepository;
  }

  public execute(
    tenantId: string,
    companyId?: string,
    severity?: EcacFindingSeverity,
  ): Promise<EcacFinding[]> {
    return this.repository.listFindings(tenantId, companyId, severity);
  }
}

export class ListEcacAlertsUseCase {
  private readonly repository: EcacRadarRepository;

  public constructor({ ecacRadarRepository }: Dependencies) {
    this.repository = ecacRadarRepository;
  }

  public execute(
    tenantId: string,
    filter: ListEcacAlertsFilter = {},
  ): Promise<EcacAlert[]> {
    const statuses: EcacAlertStatus[] = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
    if (filter.status && !statuses.includes(filter.status)) {
      throw new ValidationError('Status de alerta e-CAC inválido.');
    }
    return this.repository.listAlerts(tenantId, filter);
  }
}

export class AcknowledgeEcacAlertUseCase {
  private readonly repository: EcacRadarRepository;

  public constructor({ ecacRadarRepository }: Dependencies) {
    this.repository = ecacRadarRepository;
  }

  public execute(
    tenantId: string,
    alertId: string,
    actorId: string,
  ): Promise<EcacAlert> {
    return this.repository.acknowledgeAlertWithAudit(
      tenantId,
      alertId,
      actorId,
      new Date(),
    );
  }
}
