import { createHash, randomUUID } from 'node:crypto';
import type { CredentialCipher } from '../../../credentials/application/ports/credential-cipher.js';
import {
  EcacGatewayError,
  type EcacGateway,
  type EcacGatewayFinding,
  type EcacGatewayResult,
  type QueryEcacInput,
} from '../../application/ports/ecac-gateway.js';
import type { EcacSitfisProcessRepository } from '../../application/ports/ecac-sitfis-process-repository.js';
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
  ecacSitfisProcessRepository: EcacSitfisProcessRepository;
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

const SITFIS_DEFAULT_WAIT_MS = 5_000;
const SITFIS_MAX_WAIT_MS = 60 * 60_000;
const SITFIS_MAX_PROTOCOL_LENGTH = 8_192;
const SITFIS_MAX_PDF_BASE64_LENGTH = 16 * 1024 * 1024;

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

function parseEnvelopeData(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    return parseRecord(value);
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function waitMilliseconds(
  response: SerproHttpResponse,
  envelope?: SerproEnvelope | null,
): number {
  const data = parseEnvelopeData(envelope?.dados);
  const rawWait = data?.tempoEspera;
  const headerWait = response.headers.etag?.match(/tempoEspera\s*:\s*(\d+)/iu)?.[1];
  const candidate =
    typeof rawWait === 'number' && Number.isFinite(rawWait)
      ? rawWait
      : typeof rawWait === 'string' && /^\d+$/u.test(rawWait)
        ? Number(rawWait)
        : headerWait
          ? Number(headerWait)
          : SITFIS_DEFAULT_WAIT_MS;
  return Math.max(1_000, Math.min(SITFIS_MAX_WAIT_MS, Math.trunc(candidate)));
}

function messageCodes(envelope: SerproEnvelope | null): string[] {
  if (!Array.isArray(envelope?.mensagens)) {
    return [];
  }
  return envelope.mensagens.flatMap((message) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      Array.isArray(message)
    ) {
      return [];
    }
    const code = (message as Record<string, unknown>).codigo;
    return typeof code === 'string' ? [code] : [];
  });
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
  private readonly sitfisRepository: EcacSitfisProcessRepository;
  private readonly cipher: CredentialCipher;
  private readonly transport: SerproHttpTransport;
  private readonly authUrl: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenCache = new Map<string, TokenSet>();
  private readonly authenticationInFlight = new Map<string, Promise<TokenSet>>();

  public constructor({
    serproConnectionRepository,
    ecacSitfisProcessRepository,
    credentialCipher,
    serproHttpTransport,
    serproAuthUrl,
    serproApiBaseUrl,
    serproTimeoutMs,
  }: Dependencies) {
    this.repository = serproConnectionRepository;
    this.sitfisRepository = ecacSitfisProcessRepository;
    this.cipher = credentialCipher;
    this.transport = serproHttpTransport;
    this.authUrl = serproAuthUrl;
    this.apiBaseUrl = serproApiBaseUrl.replace(/\/+$/u, '');
    this.timeoutMs = serproTimeoutMs;
  }

  public async query(input: QueryEcacInput): Promise<EcacGatewayResult> {
    if (input.queryType === 'DEBTS') {
      throw new EcacGatewayError(
        'Esta consulta ainda não possui adaptador oficial configurado.',
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

    if (input.queryType === 'TAX_STATUS') {
      return this.querySitfis(material, input, cacheKey);
    }

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
        state: 'COMPLETED',
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

  private async querySitfis(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    cacheKey: string,
  ): Promise<EcacGatewayResult> {
    const checkpoint = await this.sitfisRepository.find(
      input.tenantId,
      input.jobId,
    );
    if (checkpoint?.status === 'COMPLETED') {
      throw new EcacGatewayError(
        'O fluxo SITFIS já foi concluído para este job.',
        'ECAC_SITFIS_ALREADY_COMPLETED',
        false,
      );
    }

    const operation =
      checkpoint?.status === 'AWAITING_REPORT'
        ? 'SITFIS_EMIT'
        : 'SITFIS_REQUEST';
    let response: SerproHttpResponse | undefined;
    try {
      response = await this.requestWithTokenRefresh(
        material,
        input,
        cacheKey,
        (tokens) =>
          operation === 'SITFIS_EMIT'
            ? this.requestSitfisReport(material, input, tokens, checkpoint)
            : this.requestSitfisProtocol(material, input, tokens),
      );

      const result =
        operation === 'SITFIS_EMIT'
          ? await this.handleSitfisReportResponse(
              input,
              checkpoint,
              response,
            )
          : await this.handleSitfisProtocolResponse(input, response);

      await this.repository.recordUseWithAudit({
        tenantId: input.tenantId,
        connectionId: material.id,
        companyId: input.companyId,
        queryType: input.queryType,
        operation,
        outcome: 'SUCCEEDED',
        providerStatus: response.status,
        occurredAt: new Date(),
      });
      return result;
    } catch (error: unknown) {
      await this.repository.recordUseWithAudit({
        tenantId: input.tenantId,
        connectionId: material.id,
        companyId: input.companyId,
        queryType: input.queryType,
        operation,
        outcome: 'FAILED',
        ...(response ? { providerStatus: response.status } : {}),
        occurredAt: new Date(),
      });
      throw error;
    }
  }

  private async requestWithTokenRefresh(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    cacheKey: string,
    request: (tokens: TokenSet) => Promise<SerproHttpResponse>,
  ): Promise<SerproHttpResponse> {
    let tokens = await this.getTokens(material, input, cacheKey, false);
    let response = await request(tokens);
    if (response.status === 401) {
      this.tokenCache.delete(cacheKey);
      tokens = await this.getTokens(material, input, cacheKey, true);
      response = await request(tokens);
    }
    return response;
  }

  private async requestSitfisProtocol(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    tokens: TokenSet,
  ): Promise<SerproHttpResponse> {
    return this.requestSitfis(
      '/Apoiar',
      material,
      input,
      tokens,
      'SOLICITARPROTOCOLO91',
      '',
    );
  }

  private async requestSitfisReport(
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    tokens: TokenSet,
    checkpoint: Awaited<ReturnType<EcacSitfisProcessRepository['find']>>,
  ): Promise<SerproHttpResponse> {
    if (
      checkpoint?.status !== 'AWAITING_REPORT' ||
      !checkpoint.encryptedProtocol
    ) {
      throw new EcacGatewayError(
        'O checkpoint SITFIS não possui protocolo válido.',
        'ECAC_SITFIS_PROTOCOL_MISSING',
        true,
      );
    }

    let protocol: Buffer | undefined;
    try {
      protocol = this.cipher.open(
        checkpoint.encryptedProtocol,
        this.sitfisProtocolContext(input),
      );
      return await this.requestSitfis(
        '/Emitir',
        material,
        input,
        tokens,
        'RELATORIOSITFIS92',
        JSON.stringify({ protocoloRelatorio: protocol.toString('utf8') }),
      );
    } finally {
      protocol?.fill(0);
    }
  }

  private async requestSitfis(
    path: '/Apoiar' | '/Emitir',
    material: SerproConnectionMaterial,
    input: QueryEcacInput,
    tokens: TokenSet,
    serviceId: 'SOLICITARPROTOCOLO91' | 'RELATORIOSITFIS92',
    data: string,
  ): Promise<SerproHttpResponse> {
    try {
      return await this.transport.request({
        url: `${this.apiBaseUrl}${path}`,
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
          jwt_token: tokens.jwtToken,
        },
        body: JSON.stringify({
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
            idSistema: 'SITFIS',
            idServico: serviceId,
            versaoSistema: '2.0',
            dados: data,
          },
        }),
        timeoutMs: this.timeoutMs,
      });
    } catch {
      throw new EcacGatewayError(
        'Não foi possível consultar o SITFIS no SERPRO.',
        'ECAC_SERPRO_NETWORK_ERROR',
        true,
      );
    }
  }

  private async handleSitfisProtocolResponse(
    input: QueryEcacInput,
    response: SerproHttpResponse,
  ): Promise<EcacGatewayResult> {
    const envelope = parseRecord(response.body) as SerproEnvelope | null;
    const data = parseEnvelopeData(envelope?.dados);
    const protocol = data?.protocoloRelatorio;
    const now = new Date();
    const providerStatus =
      typeof envelope?.status === 'number' ? envelope.status : response.status;
    const resumeAt = new Date(
      now.getTime() + waitMilliseconds(response, envelope),
    );
    const canAcceptCheckpoint =
      (response.status >= 200 && response.status < 300) ||
      response.status === 503;
    const businessCanAcceptCheckpoint =
      (providerStatus >= 200 && providerStatus < 300) ||
      providerStatus === 503;

    if (
      canAcceptCheckpoint &&
      businessCanAcceptCheckpoint &&
      typeof protocol === 'string' &&
      protocol.length >= 8 &&
      protocol.length <= SITFIS_MAX_PROTOCOL_LENGTH
    ) {
      const plaintext = Buffer.from(protocol, 'utf8');
      try {
        const sealed = this.cipher.seal(
          plaintext,
          this.sitfisProtocolContext(input),
        );
        await this.sitfisRepository.saveCheckpointWithAudit({
          id: randomUUID(),
          tenantId: input.tenantId,
          jobId: input.jobId,
          lockToken: input.lockToken,
          companyId: input.companyId,
          status: 'AWAITING_REPORT',
          encryptedProtocol: sealed.ciphertext,
          protocolKeyVersion: sealed.keyVersion,
          protocolHash: createHash('sha256').update(plaintext).digest('hex'),
          nextAttemptAt: resumeAt,
          providerStatus,
          occurredAt: now,
        });
      } finally {
        plaintext.fill(0);
      }
      return {
        state: 'DEFERRED',
        provider: 'SERPRO_INTEGRA_CONTADOR',
        resumeAt,
        providerStatus,
      };
    }

    const waitCodes = messageCodes(envelope);
    if (
      waitCodes.some((code) => code.includes('Sitfis-AV02')) ||
      waitCodes.some((code) => code.includes('Sitfis-AV03')) ||
      (response.status === 503 && providerStatus === 503)
    ) {
      await this.sitfisRepository.saveCheckpointWithAudit({
        id: randomUUID(),
        tenantId: input.tenantId,
        jobId: input.jobId,
        lockToken: input.lockToken,
        companyId: input.companyId,
        status: 'AWAITING_PROTOCOL',
        encryptedProtocol: null,
        protocolKeyVersion: null,
        protocolHash: null,
        nextAttemptAt: resumeAt,
        providerStatus,
        occurredAt: now,
      });
      return {
        state: 'DEFERRED',
        provider: 'SERPRO_INTEGRA_CONTADOR',
        resumeAt,
        providerStatus,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      throw providerError(response.status);
    }
    throw new EcacGatewayError(
      'O SERPRO devolveu um protocolo SITFIS inválido.',
      'ECAC_SERPRO_INVALID_SITFIS_PROTOCOL_RESPONSE',
      true,
    );
  }

  private async handleSitfisReportResponse(
    input: QueryEcacInput,
    checkpoint: Awaited<ReturnType<EcacSitfisProcessRepository['find']>>,
    response: SerproHttpResponse,
  ): Promise<EcacGatewayResult> {
    if (
      checkpoint?.status !== 'AWAITING_REPORT' ||
      !checkpoint.encryptedProtocol ||
      !checkpoint.protocolHash
    ) {
      throw new EcacGatewayError(
        'O checkpoint SITFIS não possui protocolo válido.',
        'ECAC_SITFIS_PROTOCOL_MISSING',
        true,
      );
    }

    const envelope = parseRecord(response.body) as SerproEnvelope | null;
    const providerStatus =
      typeof envelope?.status === 'number' ? envelope.status : response.status;
    const now = new Date();

    if (
      [202, 204, 304].includes(response.status) ||
      (response.status === 200 && providerStatus === 202)
    ) {
      const resumeAt = new Date(
        now.getTime() + waitMilliseconds(response, envelope),
      );
      await this.sitfisRepository.saveCheckpointWithAudit({
        id: checkpoint.id,
        tenantId: input.tenantId,
        jobId: input.jobId,
        lockToken: input.lockToken,
        companyId: input.companyId,
        status: 'AWAITING_REPORT',
        encryptedProtocol: checkpoint.encryptedProtocol,
        protocolKeyVersion: checkpoint.protocolKeyVersion,
        protocolHash: checkpoint.protocolHash,
        nextAttemptAt: resumeAt,
        providerStatus,
        occurredAt: now,
      });
      return {
        state: 'DEFERRED',
        provider: 'SERPRO_INTEGRA_CONTADOR',
        resumeAt,
        providerStatus,
      };
    }

    const codes = messageCodes(envelope);
    if (codes.some((code) => code.includes('Sitfis-ER05'))) {
      const resumeAt = new Date(now.getTime() + SITFIS_DEFAULT_WAIT_MS);
      await this.sitfisRepository.resetProtocolWithAudit({
        tenantId: input.tenantId,
        jobId: input.jobId,
        lockToken: input.lockToken,
        nextAttemptAt: resumeAt,
        providerStatus,
        occurredAt: now,
      });
      throw new EcacGatewayError(
        'O SERPRO solicitou um novo protocolo SITFIS.',
        'ECAC_SITFIS_PROTOCOL_RESTART_REQUIRED',
        true,
      );
    }

    if (response.status !== 200 || providerStatus !== 200 || !envelope) {
      throw providerError(providerStatus || response.status);
    }

    const data = parseEnvelopeData(envelope.dados);
    const pdf = data?.pdf;
    if (
      typeof pdf !== 'string' ||
      pdf.length < 8 ||
      pdf.length > SITFIS_MAX_PDF_BASE64_LENGTH ||
      pdf.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(pdf)
    ) {
      throw new EcacGatewayError(
        'O SERPRO devolveu um relatório SITFIS inválido.',
        'ECAC_SERPRO_INVALID_SITFIS_REPORT',
        true,
      );
    }

    const document = Buffer.from(pdf, 'base64');
    try {
      if (
        document.length === 0 ||
        document.subarray(0, 5).toString('ascii') !== '%PDF-'
      ) {
        throw new EcacGatewayError(
          'O SERPRO devolveu um relatório SITFIS inválido.',
          'ECAC_SERPRO_INVALID_SITFIS_REPORT',
          true,
        );
      }
      const reportHash = createHash('sha256').update(document).digest('hex');
      return {
        state: 'COMPLETED',
        provider: 'SERPRO_INTEGRA_CONTADOR',
        protocol: response.headers['x-request-id'] ?? null,
        fetchedAt: now,
        artifactHash: reportHash,
        payload: {
          status: providerStatus,
          reportSha256: reportHash,
          reportBytes: document.length,
          service: 'SITFIS:RELATORIOSITFIS92:2.0',
        },
        findings: [
          {
            code: 'SITFIS_REPORT_PROCESSED',
            category: 'TAX_STATUS',
            title: 'Relatório de situação fiscal processado',
            description:
              'O relatório foi recebido, validado e resumido sem persistir o PDF bruto.',
            severity: 'INFO',
            sourceReference: 'SITFIS:RELATORIOSITFIS92:2.0',
            observedAt: now,
          },
        ],
      };
    } finally {
      document.fill(0);
    }
  }

  private sitfisProtocolContext(input: QueryEcacInput): string {
    return `tenant:${input.tenantId}:ecac:sitfis:${input.jobId}:protocol`;
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
