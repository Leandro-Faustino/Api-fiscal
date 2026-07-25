import { NotFoundError } from '../../../../shared/domain/app-error.js';
import type { EcacRadarRepository } from '../ports/ecac-radar-repository.js';
import type {
  EcacFinding,
  EcacFindingSeverity,
  EcacSyncBatch,
  EcacSyncBatchStatus,
} from '../../domain/ecac-radar.js';

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
