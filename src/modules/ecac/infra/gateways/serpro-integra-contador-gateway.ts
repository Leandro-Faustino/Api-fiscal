import { randomUUID } from 'node:crypto';
import type { CredentialCipher } from '../../../credentials/application/ports/credential-cipher.js';
import {
  EcacGatewayError,
  type EcacGateway,
  type EcacGatewayFinding,
  type EcacGatewayResult,
  type QueryEcacInput,
} from '../../application/ports/ecac-gateway.js';
import type {
  SerproConnectionMaterial,
  SerproConnectionRepository,
} from '../../application/ports/serpro-connection-repository.js';
import type {
  SerproHttpResponse,
  SerproHttpTransport,
} from '../../application/ports/serpro-http-transport.js';

interface Dependencies {
  serproConnectionRepository: SerproConnectionRepository;
  credentialCipher: CredentialCipher;
  serproHttpTransport: SerproHttpTransport;
  serproAuthUrl: string;
  serproApiBaseUrl: string;
  serproTimeoutMs: number;
}

interface TokenSet {
  accessToken: string;
  jwtToken: string;
  expiresAt: number;
}

interface SerproEnvelope {
  status?: unknown;
  dados?: unknown;
  mensagens?: unknown;
}

interface MailboxData {
  code: string;
  newMessagesIndicator: 0 | 1 | 2;
}

function parseRecord(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function providerError(status: number): EcacGatewayError {
  const retriable =
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500;
  return new EcacGatewayError(
    retriable
      ? 'O SERPRO está temporariamente indisponível.'
      : 'O SERPRO rejeitou a consulta fiscal.',
    `ECAC_SERPRO_HTTP_${status || 'NETWORK'}`,
    retriable,
  );
}

function mailboxFinding(
  data: MailboxData,
  observedAt: Date,
): EcacGatewayFinding {
  if (data.newMessagesIndicator === 0) {
    return {
      code: 'MAILBOX_NO_NEW_MESSAGES',
      category: 'MAILBOX',
      title: 'Caixa Postal sem novas mensagens',
      description: 'O SERPRO não informou novas mensagens para o contribuinte.',
      severity: 'INFO',
      sourceReference: 'CAIXAPOSTAL:INNOVAMSG63',
      observedAt,
    };
  }

  if (data.newMessagesIndicator === 1) {
    return {
      code: 'MAILBOX_NEW_MESSAGE',
      category: 'MAILBOX',
      title: 'Caixa Postal com nova mensagem',
      description: 'O SERPRO informou uma nova mensagem para o contribuinte.',
      severity: 'WARNING',
      sourceReference: 'CAIXAPOSTAL:INNOVAMSG63',
      observedAt,
    };
  }

  return {
    code: 'MAILBOX_NEW_MESSAGES',
    category: 'MAILBOX',
    title: 'Caixa Postal com novas mensagens',
    description: 'O SERPRO informou mais de uma nova mensagem para o contribuinte.',
    severity: 'WARNING',
    sourceReference: 'CAIXAPOSTAL:INNOVAMSG63',
    observedAt,
  };
}

export class SerproIntegraContadorGateway implements EcacGateway {
  private readonly repository: SerproConnectionRepository;
  private readonly cipher: CredentialCipher;
  private readonly transport: SerproHttpTransport;
  private readonly authUrl: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenCache = new Map<string, TokenSet>();
  private readonly authenticationInFlight = new Map<string, Promise<TokenSet>>();

  public constructor({
    serproConnectionRepository,
    credentialCipher,
    serproHttpTransport,
    serproAuthUrl,
    serproApiBaseUrl,
    serproTimeoutMs,
  }: Dependencies) {
    this.repository = serproConnectionRepository;
    this.cipher = credentialCipher;
    this.transport = serproHttpTransport;
    this.authUrl = serproAuthUrl;
    this.apiBaseUrl = serproApiBaseUrl.replace(/\/+$/u, '');
    this.timeoutMs = serproTimeoutMs;
  }

  public async query(input: QueryEcacInput): Promise<EcacGatewayResult> {
    if (input.queryType !== 'MAILBOX') {
      throw new EcacGatewayError(
        'Esta consulta exige a próxima etapa do adaptador SITFIS.',
        'ECAC_SERPRO_QUERY_NOT_SUPPORTED',
        false,
      );
    }

    const material = await this.repository.getMaterialForUse(
      input.tenantId,
      input.certificateId,
      new Date(),
    );
    if (!material) {
      throw new EcacGatewayError(
        'A conexão SERPRO ou o certificado contratante não está disponível.',
        'ECAC_SERPRO_CONNECTION_NOT_CONFIGURED',
        false,
      );
    }

    const cacheKey = [
      material.id,
      material.connectionUpdatedAt.getTime(),
      material.certificateFingerprintSha256,
    ].join(':');

    let response: SerproHttpResponse | undefined;
    try {
      let tokens = await this.getTokens(material, input, cacheKey, false);
      response = await this.requestMailbox(material, input, tokens);
      if (response.status === 401) {
        this.tokenCache.delete(cacheKey);
        tokens = await this.getTokens(material, input, cacheKey, true);
        response = await this.requestMailbox(material, input, tokens);
      }

      if (response.status < 200 || response.status >= 300) {
        throw providerError(response.status);
      }

      const envelope = parseRecord(response.body) as SerproEnvelope | null;
      if (!envelope) {
        throw new EcacGatewayError(
          'O SERPRO devolveu uma resposta inválida.',
          'ECAC_SERPRO_INVALID_RESPONSE',
          true,
        );
      }

      const businessStatus =
        typeof envelope.status === 'number' ? envelope.status : response.status;
      if (businessStatus < 200 || businessStatus >= 300) {
        throw providerError(businessStatus);
      }

      const data = this.parseMailboxData(envelope.dados);
      const fetchedAt = new Date();
      const protocol = response.headers['x-request-id'] ?? randomUUID();

      await this.repository.recordUseWithAudit({
        tenantId: input.tenantId,
        connectionId: material.id,
        companyId: input.companyId,
        queryType: input.queryType,
        operation: 'QUERY',
        outcome: 'SUCCEEDED',
        providerStatus: response.status,
        occurredAt: fetchedAt,
      });

      return {
        provider: 'SERPRO_INTEGRA_CONTADOR',
        protocol,
        fetchedAt,
        payload: {
          status: businessStatus,
          code: data.code,
          newMessagesIndicator: data.newMessagesIndicator,
        },
        findings: [mailboxFinding(data, fetchedAt)],
      };
    } catch (error: unknown) {
      await this.repository.recordUseWithAudit({
        tenantId: input.tenantId,
        connectionId: material.id,
        companyId: input.companyId,
        queryType: input.queryType,
        operation: 'QUERY',
        outcome: 'FAILED',
        ...(response ? { providerStatus: response.status } : {}),
        occurredAt: new Date(),
      });
      throw error;
    }
  }

  private async getTokens(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    cacheKey: string,
    forceRefresh: boolean,
  ): Promise<TokenSet> {
    const cached = this.tokenCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 30_000) {
      return cached;
    }

    const pending = this.authenticationInFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const authentication = this.authenticate(material, input)
      .then((tokens) => {
        this.tokenCache.set(cacheKey, tokens);
        return tokens;
      })
      .finally(() => {
        this.authenticationInFlight.delete(cacheKey);
      });
    this.authenticationInFlight.set(cacheKey, authentication);
    return authentication;
  }

  private async authenticate(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
  ): Promise<TokenSet> {
    const certificatePrefix =
      `certificate:${material.tenantId}:${material.certificateId}`;
    let bundle: Buffer | undefined;
    let password: Buffer | undefined;
    let consumerKey: Buffer | undefined;
    let consumerSecret: Buffer | undefined;
    let useAudited = false;

    try {
      bundle = this.cipher.open(
        material.encryptedCertificateBundle,
        `${certificatePrefix}:bundle`,
      );
      password = this.cipher.open(
        material.encryptedCertificatePassword,
        `${certificatePrefix}:password`,
      );
      consumerKey = this.cipher.open(
        material.encryptedConsumerKey,
        `tenant:${material.tenantId}:serpro:consumer-key`,
      );
      consumerSecret = this.cipher.open(
        material.encryptedConsumerSecret,
        `tenant:${material.tenantId}:serpro:consumer-secret`,
      );

      const basic = Buffer.from(
        `${consumerKey.toString('utf8')}:${consumerSecret.toString('utf8')}`,
        'utf8',
      ).toString('base64');
      const response = await this.transport.request({
        url: this.authUrl,
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
          'role-type': 'TERCEIROS',
        },
        body: 'grant_type=client_credentials',
        timeoutMs: this.timeoutMs,
        pfx: bundle,
        passphrase: password.toString('utf8'),
      });

      await this.repository.recordUseWithAudit({
        tenantId: input.tenantId,
        connectionId: material.id,
        companyId: input.companyId,
        queryType: input.queryType,
        operation: 'AUTHENTICATE',
        outcome: response.status >= 200 && response.status < 300
          ? 'SUCCEEDED'
          : 'FAILED',
        providerStatus: response.status,
        occurredAt: new Date(),
      });
      useAudited = true;

      if (response.status < 200 || response.status >= 300) {
        throw providerError(response.status);
      }

      const parsed = parseRecord(response.body);
      const accessToken = parsed?.access_token;
      const jwtToken = parsed?.jwt_token;
      const expiresIn = parsed?.expires_in;
      if (
        typeof accessToken !== 'string' ||
        accessToken.length < 8 ||
        typeof jwtToken !== 'string' ||
        jwtToken.length < 8 ||
        typeof expiresIn !== 'number' ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0
      ) {
        throw new EcacGatewayError(
          'O SERPRO devolveu tokens inválidos.',
          'ECAC_SERPRO_INVALID_TOKEN_RESPONSE',
          true,
        );
      }

      return {
        accessToken,
        jwtToken,
        expiresAt: Date.now() + Math.min(expiresIn, 86_400) * 1_000,
      };
    } catch (error: unknown) {
      if (!useAudited) {
        await this.repository.recordUseWithAudit({
          tenantId: input.tenantId,
          connectionId: material.id,
          companyId: input.companyId,
          queryType: input.queryType,
          operation: 'AUTHENTICATE',
          outcome: 'FAILED',
          occurredAt: new Date(),
        });
      }
      if (error instanceof EcacGatewayError) {
        throw error;
      }
      throw new EcacGatewayError(
        'Não foi possível autenticar no SERPRO.',
        'ECAC_SERPRO_AUTHENTICATION_FAILED',
        true,
      );
    } finally {
      bundle?.fill(0);
      password?.fill(0);
      consumerKey?.fill(0);
      consumerSecret?.fill(0);
    }
  }

  private async requestMailbox(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    tokens: TokenSet,
  ): Promise<SerproHttpResponse> {
    const body = JSON.stringify({
      contratante: {
        numero: material.contractorCnpj,
        tipo: 2,
      },
      autorPedidoDados: {
        numero: material.requesterCnpj,
        tipo: 2,
      },
      contribuinte: {
        numero: input.companyCnpj,
        tipo: 2,
      },
      pedidoDados: {
        idSistema: 'CAIXAPOSTAL',
        idServico: 'INNOVAMSG63',
        versaoSistema: '1.0',
        dados: '',
      },
    });

    try {
      return await this.transport.request({
        url: `${this.apiBaseUrl}/Consultar`,
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
          jwt_token: tokens.jwtToken,
        },
        body,
        timeoutMs: this.timeoutMs,
      });
    } catch {
      throw new EcacGatewayError(
        'Não foi possível consultar o SERPRO.',
        'ECAC_SERPRO_NETWORK_ERROR',
        true,
      );
    }
  }

  private parseMailboxData(value: unknown): MailboxData {
    const parsed =
      typeof value === 'string' ? parseRecord(value) : value;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new EcacGatewayError(
        'O SERPRO devolveu dados inválidos da Caixa Postal.',
        'ECAC_SERPRO_INVALID_MAILBOX_RESPONSE',
        true,
      );
    }
    const record = parsed as Record<string, unknown>;
    const code = record.codigo;
    const content = record.conteudo;
    const first =
      Array.isArray(content) &&
      typeof content[0] === 'object' &&
      content[0] !== null &&
      !Array.isArray(content[0])
        ? (content[0] as Record<string, unknown>)
        : null;
    const rawIndicator = first?.indicadorMensagensNovas;
    const indicator =
      typeof rawIndicator === 'string' && /^[012]$/u.test(rawIndicator)
        ? Number(rawIndicator)
        : rawIndicator;
    if (
      typeof code !== 'string' ||
      code.length === 0 ||
      code.length > 20 ||
      typeof indicator !== 'number' ||
      ![0, 1, 2].includes(indicator)
    ) {
      throw new EcacGatewayError(
        'O SERPRO devolveu dados inválidos da Caixa Postal.',
        'ECAC_SERPRO_INVALID_MAILBOX_RESPONSE',
        true,
      );
    }
    return {
      code,
      newMessagesIndicator: indicator as 0 | 1 | 2,
    };
  }
}
