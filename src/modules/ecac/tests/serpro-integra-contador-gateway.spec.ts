import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CredentialCipher } from '../../credentials/application/ports/credential-cipher.js';
import { EcacGatewayError } from '../application/ports/ecac-gateway.js';
import type { QueryEcacInput } from '../application/ports/ecac-gateway.js';
import type { EcacSitfisProcessRepository } from '../application/ports/ecac-sitfis-process-repository.js';
import type { EcacSitfisProcess } from '../domain/ecac-sitfis-process.js';
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
  jobId: '10000000-0000-4000-8000-000000000006',
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
    seal: vi.fn((plaintext, context) => ({
      ciphertext: `sealed:${context}:${plaintext.toString('base64url')}`,
      keyVersion: 1,
    })),
    open: vi.fn((ciphertext) => {
      if (ciphertext.startsWith('sealed:')) {
        return Buffer.from(ciphertext.split(':').at(-1) ?? '', 'base64url');
      }
      return Buffer.from(values[ciphertext] ?? '');
    }),
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

function sitfisRepository(
  checkpoint: EcacSitfisProcess | null = null,
): EcacSitfisProcessRepository {
  return {
    find: vi.fn(async () => checkpoint),
    saveCheckpointWithAudit: vi.fn(async () => undefined),
    resetProtocolWithAudit: vi.fn(async () => undefined),
    listEncryptedForRotation: vi.fn(async () => []),
    rotateEncryptionWithAudit: vi.fn(async () => false),
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
  ecacSitfisProcessRepository = sitfisRepository(),
): SerproIntegraContadorGateway {
  return new SerproIntegraContadorGateway({
    serproConnectionRepository,
    ecacSitfisProcessRepository,
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

    expect(result.state).toBe('COMPLETED');
    if (result.state !== 'COMPLETED') {
      throw new Error('Resultado inesperadamente adiado.');
    }
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

  it('solicita protocolo SITFIS 2.0 e persiste somente a forma cifrada', async () => {
    const protocol = randomBytes(96).toString('base64');
    const sitfis = sitfisRepository();
    const requests: SerproHttpRequest[] = [];
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input) => {
        requests.push(input);
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
            protocoloRelatorio: protocol,
            tempoEspera: 4_000,
          }),
          mensagens: [{ codigo: '[Sucesso-Sitfis-SC01]' }],
        });
      }),
    };

    const result = await gateway(transport, repository(), sitfis).query({
      ...queryInput,
      queryType: 'TAX_STATUS',
    });

    expect(result).toMatchObject({
      state: 'DEFERRED',
      provider: 'SERPRO_INTEGRA_CONTADOR',
      providerStatus: 200,
    });
    expect(requests[1]?.url).toBe(
      'https://api.example.test/integra-contador/v1/Apoiar',
    );
    expect(JSON.parse(requests[1]!.body)).toMatchObject({
      pedidoDados: {
        idSistema: 'SITFIS',
        idServico: 'SOLICITARPROTOCOLO91',
        versaoSistema: '2.0',
        dados: '',
      },
    });
    expect(sitfis.saveCheckpointWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'AWAITING_REPORT',
        encryptedProtocol: expect.not.stringContaining(protocol),
        protocolHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(protocol);
  });

  it('respeita o ETag de espera quando a emissão SITFIS responde 204', async () => {
    const protocol = randomBytes(96).toString('base64');
    const encryptedProtocol = `sealed:context:${Buffer.from(protocol).toString('base64url')}`;
    const checkpoint: EcacSitfisProcess = {
      id: '10000000-0000-4000-8000-000000000007',
      tenantId,
      jobId: queryInput.jobId,
      companyId,
      status: 'AWAITING_REPORT',
      encryptedProtocol,
      protocolKeyVersion: 1,
      protocolHash: 'b'.repeat(64),
      nextAttemptAt: new Date('2026-07-26T06:00:00.000Z'),
      providerStatus: 200,
      reportHash: null,
      completedAt: null,
      createdAt: new Date('2026-07-26T06:00:00.000Z'),
      updatedAt: new Date('2026-07-26T06:00:00.000Z'),
    };
    const sitfis = sitfisRepository(checkpoint);
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input) => {
        if (input.url.includes('authenticate')) {
          return response(200, {
            access_token: testAccessToken,
            jwt_token: testJwtToken,
            expires_in: 1800,
          });
        }
        return {
          status: 204,
          headers: { etag: '"tempoEspera:4000"' },
          body: '',
        };
      }),
    };

    const result = await gateway(transport, repository(), sitfis).query({
      ...queryInput,
      queryType: 'TAX_STATUS',
    });

    expect(result.state).toBe('DEFERRED');
    expect(sitfis.saveCheckpointWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'AWAITING_REPORT',
        providerStatus: 204,
        encryptedProtocol,
      }),
    );
  });

  it('valida o PDF SITFIS e retorna somente hash, tamanho e achado', async () => {
    const protocol = randomBytes(96).toString('base64');
    const encryptedProtocol = `sealed:context:${Buffer.from(protocol).toString('base64url')}`;
    const checkpoint: EcacSitfisProcess = {
      id: '10000000-0000-4000-8000-000000000008',
      tenantId,
      jobId: queryInput.jobId,
      companyId,
      status: 'AWAITING_REPORT',
      encryptedProtocol,
      protocolKeyVersion: 1,
      protocolHash: 'c'.repeat(64),
      nextAttemptAt: new Date('2026-07-26T06:00:00.000Z'),
      providerStatus: 202,
      reportHash: null,
      completedAt: null,
      createdAt: new Date('2026-07-26T06:00:00.000Z'),
      updatedAt: new Date('2026-07-26T06:00:00.000Z'),
    };
    const pdf = Buffer.from('%PDF-1.7\nSITFIS test document\n%%EOF');
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
          dados: JSON.stringify({ pdf: pdf.toString('base64') }),
          mensagens: [{ codigo: '[Sucesso-Sitfis-SC01]' }],
        });
      }),
    };

    const result = await gateway(
      transport,
      repository(),
      sitfisRepository(checkpoint),
    ).query({
      ...queryInput,
      queryType: 'TAX_STATUS',
    });

    expect(result.state).toBe('COMPLETED');
    if (result.state !== 'COMPLETED') {
      throw new Error('Resultado inesperadamente adiado.');
    }
    expect(result).toMatchObject({
      artifactHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      payload: {
        status: 200,
        reportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reportBytes: pdf.length,
        service: 'SITFIS:RELATORIOSITFIS92:2.0',
      },
      findings: [{ code: 'SITFIS_REPORT_PROCESSED' }],
    });
    expect(JSON.stringify(result)).not.toContain(pdf.toString('base64'));
    expect(JSON.stringify(result)).not.toContain(protocol);
  });

  it('apaga o protocolo e reinicia por Apoiar quando o SITFIS retorna ER05', async () => {
    const protocol = randomBytes(96).toString('base64');
    const checkpoint: EcacSitfisProcess = {
      id: '10000000-0000-4000-8000-000000000009',
      tenantId,
      jobId: queryInput.jobId,
      companyId,
      status: 'AWAITING_REPORT',
      encryptedProtocol:
        `sealed:context:${Buffer.from(protocol).toString('base64url')}`,
      protocolKeyVersion: 1,
      protocolHash: 'e'.repeat(64),
      nextAttemptAt: new Date('2026-07-26T06:00:00.000Z'),
      providerStatus: 202,
      reportHash: null,
      completedAt: null,
      createdAt: new Date('2026-07-26T06:00:00.000Z'),
      updatedAt: new Date('2026-07-26T06:00:00.000Z'),
    };
    const sitfis = sitfisRepository(checkpoint);
    const transport: SerproHttpTransport = {
      request: vi.fn(async (input) => {
        if (input.url.includes('authenticate')) {
          return response(200, {
            access_token: testAccessToken,
            jwt_token: testJwtToken,
            expires_in: 1800,
          });
        }
        return response(500, {
          status: 500,
          dados: '',
          mensagens: [
            {
              codigo: '[Erro-Sitfis-ER05]',
              texto: 'Inicie uma nova solicitação.',
            },
          ],
        });
      }),
    };

    await expect(
      gateway(transport, repository(), sitfis).query({
        ...queryInput,
        queryType: 'TAX_STATUS',
      }),
    ).rejects.toMatchObject({
      code: 'ECAC_SITFIS_PROTOCOL_RESTART_REQUIRED',
      retriable: true,
    } satisfies Partial<EcacGatewayError>);
    expect(sitfis.resetProtocolWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        jobId: queryInput.jobId,
        providerStatus: 500,
      }),
    );
  });

  it('mantém consultas ainda não implementadas bloqueadas', async () => {
    const adapter = gateway({ request: vi.fn() });

    await expect(
      adapter.query({ ...queryInput, queryType: 'DEBTS' }),
    ).rejects.toMatchObject({
      code: 'ECAC_SERPRO_QUERY_NOT_SUPPORTED',
      retriable: false,
    } satisfies Partial<EcacGatewayError>);
  });
});
