import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CredentialCipher } from '../../credentials/application/ports/credential-cipher.js';
import { EcacGatewayError } from '../application/ports/ecac-gateway.js';
import type { QueryEcacInput } from '../application/ports/ecac-gateway.js';
import type {
  SerproConnectionMaterial,
  SerproConnectionRepository,
} from '../application/ports/serpro-connection-repository.js';
import type {
  SerproHttpRequest,
  SerproHttpResponse,
  SerproHttpTransport,
} from '../application/ports/serpro-http-transport.js';
import { SerproIntegraContadorGateway } from '../infra/gateways/serpro-integra-contador-gateway.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const companyId = '10000000-0000-4000-8000-000000000002';
const certificateId = '10000000-0000-4000-8000-000000000003';
const testAccessToken = randomBytes(32).toString('base64url');
const testJwtToken = randomBytes(32).toString('base64url');
const testConsumerKey = randomBytes(24).toString('base64url');
const testConsumerSecret = randomBytes(36).toString('base64url');

const queryInput: QueryEcacInput = {
  tenantId,
  companyId,
  companyCnpj: '11222333000181',
  powerOfAttorneyId: '10000000-0000-4000-8000-000000000004',
  certificateId,
  queryType: 'MAILBOX',
};

function material(): SerproConnectionMaterial {
  return {
    id: '10000000-0000-4000-8000-000000000005',
    tenantId,
    certificateId,
    contractorCnpj: '11222333000181',
    requesterCnpj: '11222333000181',
    encryptedConsumerKey: 'consumer-key',
    encryptedConsumerSecret: 'consumer-secret',
    connectionKeyVersion: 1,
    connectionUpdatedAt: new Date('2026-07-26T06:00:00.000Z'),
    encryptedCertificateBundle: 'certificate-bundle',
    encryptedCertificatePassword: 'certificate-password',
    certificateKeyVersion: 1,
    certificateFingerprintSha256: 'a'.repeat(64),
  };
}

function cipher(): CredentialCipher {
  const values: Record<string, string> = {
    'consumer-key': testConsumerKey,
    'consumer-secret': testConsumerSecret,
    'certificate-bundle': 'pfx-value',
    'certificate-password': 'pfx-password',
  };
  return {
    seal: vi.fn(),
    open: vi.fn((ciphertext) => Buffer.from(values[ciphertext] ?? '')),
    getActiveKeyVersion: vi.fn(() => 1),
  };
}

function repository(): SerproConnectionRepository {
  return {
    configureWithAudit: vi.fn(),
    find: vi.fn(async () => null),
    getMaterialForUse: vi.fn(async () => material()),
    getEncryptedForRotation: vi.fn(async () => null),
    rotateEncryptionWithAudit: vi.fn(async () => false),
    recordUseWithAudit: vi.fn(async () => undefined),
  };
}

function response(
  status: number,
  body: Record<string, unknown>,
): SerproHttpResponse {
  return {
    status,
    headers: {},
    body: JSON.stringify(body),
  };
}

function gateway(
  serproHttpTransport: SerproHttpTransport,
  serproConnectionRepository = repository(),
): SerproIntegraContadorGateway {
  return new SerproIntegraContadorGateway({
    serproConnectionRepository,
    credentialCipher: cipher(),
    serproHttpTransport,
    serproAuthUrl: 'https://auth.example.test/authenticate',
    serproApiBaseUrl: 'https://api.example.test/integra-contador/v1',
    serproTimeoutMs: 5_000,
  });
}

describe('adaptador Integra Contador/Serpro', () => {
  it('autentica com mTLS e normaliza o indicador da Caixa Postal sem expor tokens', async () => {
    const requests: Array<{
      url: string;
      authorization: string | undefined;
      jwtToken: string | undefined;
      pfx: Buffer | undefined;
      body: string;
    }> = [];
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input: SerproHttpRequest) => {
        requests.push({
          url: input.url,
          authorization: input.headers.authorization,
          jwtToken: input.headers.jwt_token,
          pfx: input.pfx ? Buffer.from(input.pfx) : undefined,
          body: input.body,
        });
        if (input.url.includes('authenticate')) {
          return response(200, {
            access_token: testAccessToken,
            jwt_token: testJwtToken,
            expires_in: 1800,
          });
        }
        return response(200, {
          status: 200,
          dados: JSON.stringify({
            codigo: '00',
            conteudo: [{ indicadorMensagensNovas: '2' }],
          }),
          mensagens: [],
        });
      }),
    };

    const result = await gateway(transport).query(queryInput);

    expect(result).toMatchObject({
      provider: 'SERPRO_INTEGRA_CONTADOR',
      payload: {
        status: 200,
        code: '00',
        newMessagesIndicator: 2,
      },
      findings: [
        {
          code: 'MAILBOX_NEW_MESSAGES',
          category: 'MAILBOX',
          severity: 'WARNING',
        },
      ],
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://auth.example.test/authenticate',
      authorization: `Basic ${Buffer.from(
        `${testConsumerKey}:${testConsumerSecret}`,
      ).toString('base64')}`,
      pfx: Buffer.from('pfx-value'),
      body: 'grant_type=client_credentials',
    });
    expect(requests[1]).toMatchObject({
      url: 'https://api.example.test/integra-contador/v1/Consultar',
      authorization: `Bearer ${testAccessToken}`,
      jwtToken: testJwtToken,
    });
    expect(JSON.parse(requests[1]!.body)).toMatchObject({
      contratante: { numero: '11222333000181', tipo: 2 },
      contribuinte: { numero: '11222333000181', tipo: 2 },
      pedidoDados: {
        idSistema: 'CAIXAPOSTAL',
        idServico: 'INNOVAMSG63',
        versaoSistema: '1.0',
        dados: '',
      },
    });
    expect(JSON.stringify(result)).not.toContain(testAccessToken);
    expect(JSON.stringify(result)).not.toContain(testJwtToken);
  });

  it('reutiliza tokens válidos entre consultas', async () => {
    let authenticationCount = 0;
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input) => {
        if (input.url.includes('authenticate')) {
          authenticationCount += 1;
          return response(200, {
            access_token: testAccessToken,
            jwt_token: testJwtToken,
            expires_in: 1800,
          });
        }
        return response(200, {
          status: 200,
          dados: JSON.stringify({
            codigo: '00',
            conteudo: [{ indicadorMensagensNovas: '0' }],
          }),
        });
      }),
    };
    const adapter = gateway(transport);

    await adapter.query(queryInput);
    await adapter.query(queryInput);

    expect(authenticationCount).toBe(1);
    expect(transport.request).toHaveBeenCalledTimes(3);
  });

  it('renova os tokens uma vez quando o gateway responde 401', async () => {
    let authCount = 0;
    let queryCount = 0;
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input) => {
        if (input.url.includes('authenticate')) {
          authCount += 1;
          return response(200, {
            access_token: `${testAccessToken}-${authCount}`,
            jwt_token: `${testJwtToken}-${authCount}`,
            expires_in: 1800,
          });
        }
        queryCount += 1;
        if (queryCount === 1) {
          return response(401, {});
        }
        return response(200, {
          status: 200,
          dados: JSON.stringify({
            codigo: '00',
            conteudo: [{ indicadorMensagensNovas: '1' }],
          }),
        });
      }),
    };

    const result = await gateway(transport).query(queryInput);

    expect(result.findings[0]?.code).toBe('MAILBOX_NEW_MESSAGE');
    expect(authCount).toBe(2);
    expect(queryCount).toBe(2);
  });

  it('rejeita uma resposta malformada e audita a consulta como falha', async () => {
    const serproConnectionRepository = repository();
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input) => {
        if (input.url.includes('authenticate')) {
          return response(200, {
            access_token: testAccessToken,
            jwt_token: testJwtToken,
            expires_in: 1800,
          });
        }
        return response(200, {
          status: 200,
          dados: JSON.stringify({
            codigo: '00',
            conteudo: [],
          }),
        });
      }),
    };

    await expect(
      gateway(transport, serproConnectionRepository).query(queryInput),
    ).rejects.toMatchObject({
      code: 'ECAC_SERPRO_INVALID_MAILBOX_RESPONSE',
      retriable: true,
    } satisfies Partial<EcacGatewayError>);
    expect(
      serproConnectionRepository.recordUseWithAudit,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: 'QUERY',
        outcome: 'FAILED',
        providerStatus: 200,
      }),
    );
  });

  it('não tenta consultas SITFIS antes do orquestrador persistente', async () => {
    const adapter = gateway({ request: vi.fn() });

    await expect(
      adapter.query({ ...queryInput, queryType: 'TAX_STATUS' }),
    ).rejects.toMatchObject({
      code: 'ECAC_SERPRO_QUERY_NOT_SUPPORTED',
      retriable: false,
    } satisfies Partial<EcacGatewayError>);
  });
});
