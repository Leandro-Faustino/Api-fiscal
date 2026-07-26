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
  jobId: string;
  lockToken: string;
  tenantId: string;
  companyId: string;
  companyCnpj: string;
  powerOfAttorneyId: string;
  certificateId: string;
  queryType: EcacQueryType;
}

export interface EcacGatewayCompletedResult {
  state: 'COMPLETED';
  provider: string;
  protocol: string | null;
  fetchedAt: Date;
  payload: Record<string, unknown>;
  findings: EcacGatewayFinding[];
  artifactHash?: string | null;
}

export interface EcacGatewayDeferredResult {
  state: 'DEFERRED';
  provider: string;
  resumeAt: Date;
  providerStatus: number;
}

export type EcacGatewayResult =
  | EcacGatewayCompletedResult
  | EcacGatewayDeferredResult;

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
