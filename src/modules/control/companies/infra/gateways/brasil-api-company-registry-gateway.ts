import { ExternalServiceError, NotFoundError } from '../../../../../shared/domain/app-error.js';
import type {
  CompanyRegistryData,
  CompanyRegistryGateway,
} from '../../application/ports/company-registry-gateway.js';
import type { CompanyRegistrationStatus } from '../../domain/company.js';

interface Dependencies {
  companyRegistryBaseUrl: string;
  companyRegistryTimeoutMs: number;
}

interface BrasilApiCnpjResponse {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string | null;
  data_inicio_atividade?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

const statusMap: Record<string, CompanyRegistrationStatus> = {
  ATIVA: 'ACTIVE',
  INAPTA: 'INACTIVE',
  NULA: 'INACTIVE',
  SUSPENSA: 'SUSPENDED',
  BAIXADA: 'CLOSED',
};

export class BrasilApiCompanyRegistryGateway implements CompanyRegistryGateway {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor({ companyRegistryBaseUrl, companyRegistryTimeoutMs }: Dependencies) {
    this.baseUrl = companyRegistryBaseUrl.replace(/\/$/, '');
    this.timeoutMs = companyRegistryTimeoutMs;
  }

  public async lookup(cnpj: string): Promise<CompanyRegistryData> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/${cnpj}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw new ExternalServiceError('Não foi possível consultar os dados do CNPJ.', {
        provider: 'BRASIL_API',
        cause: error instanceof Error ? error.name : 'unknown',
      });
    }

    if (response.status === 404) {
      throw new NotFoundError('CNPJ não localizado na fonte cadastral.', 'CNPJ_NOT_FOUND');
    }

    if (!response.ok) {
      throw new ExternalServiceError('A fonte cadastral retornou uma falha.', {
        provider: 'BRASIL_API',
        statusCode: response.status,
      });
    }

    const data = (await response.json()) as BrasilApiCnpjResponse;
    const statusKey = data.descricao_situacao_cadastral?.trim().toUpperCase() ?? '';

    return {
      cnpj: data.cnpj.replace(/\D/g, ''),
      legalName: data.razao_social,
      tradeName: data.nome_fantasia?.trim() || null,
      registrationStatus: statusMap[statusKey] ?? 'UNKNOWN',
      openingDate: parseDate(data.data_inicio_atividade),
      primaryCnae: data.cnae_fiscal == null ? null : String(data.cnae_fiscal),
      primaryCnaeDescription: data.cnae_fiscal_descricao?.trim() || null,
      municipality: data.municipio?.trim() || null,
      state: data.uf?.trim().toUpperCase() || null,
      source: 'BRASIL_API',
      consultedAt: new Date(),
    };
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
