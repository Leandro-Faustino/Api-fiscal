import type {
  EcacFindingSeverity,
  EcacQueryType,
} from '../../domain/ecac-radar.js';

export interface EcacGatewayFinding {
  code: string;
  category: string;
  title: string;
  description?: string | null;
  severity: EcacFindingSeverity;
  sourceReference?: string | null;
  observedAt: Date;
}

export interface QueryEcacInput {
  tenantId: string;
  companyId: string;
  companyCnpj: string;
  powerOfAttorneyId: string;
  certificateId: string;
  queryType: EcacQueryType;
}

export interface EcacGatewayResult {
  provider: string;
  protocol: string | null;
  fetchedAt: Date;
  payload: Record<string, unknown>;
  findings: EcacGatewayFinding[];
}

export interface EcacGateway {
  query(input: QueryEcacInput): Promise<EcacGatewayResult>;
}

export class EcacGatewayError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly retriable: boolean,
  ) {
    super(message);
    this.name = 'EcacGatewayError';
  }
}
