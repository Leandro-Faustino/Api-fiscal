import { asValue } from 'awilix';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import type {
  CompanyRegistryData,
  CompanyRegistryGateway,
} from '../../src/modules/control/companies/application/ports/company-registry-gateway.js';
import { createApplicationContainer } from '../../src/shared/container.js';
import { generateTotpCode } from '../../src/modules/access/infra/security/totp-mfa-service.js';
import { createTestPkcs12 } from '../../src/modules/credentials/tests/pkcs12-fixture.js';
import type { EcacGateway } from '../../src/modules/ecac/application/ports/ecac-gateway.js';
import { acquireEcacStreamLock } from '../../src/modules/ecac/infra/repositories/prisma-ecac-radar-repository.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

const testPassword = `Test-${randomBytes(24).toString('base64url')}-9aA`;
const replacementTestPassword = `Next-${randomBytes(24).toString('base64url')}-9aA`;

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3333,
  LOG_LEVEL: 'silent',
  DATABASE_URL: databaseUrl,
  JWT_SECRET: randomBytes(48).toString('base64url'),
  JWT_ISSUER: 'api-fiscal-integration',
  JWT_AUDIENCE: 'api-fiscal-integration-client',
  JWT_EXPIRES_IN: '15m',
  REFRESH_TOKEN_TTL_DAYS: 30,
  AUTH_RATE_LIMIT_MAX: 100,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
  ENABLE_SWAGGER_UI: false,
  MFA_ENCRYPTION_KEY: randomBytes(48).toString('base64url'),
  CREDENTIAL_VAULT_MASTER_KEY: randomBytes(32).toString('base64'),
  CREDENTIAL_VAULT_KEY_VERSION: 1,
  CREDENTIAL_VAULT_PREVIOUS_KEYS: '{}',
  MFA_ISSUER: 'API Fiscal Integration',
  MFA_CHALLENGE_TTL_MINUTES: 5,
  MFA_MAXIMUM_ATTEMPTS: 5,
  PASSWORD_RESET_TTL_MINUTES: 15,
  EXPOSE_RECOVERY_TOKENS: true,
  INVITATION_TTL_HOURS: 72,
  COMPANY_REGISTRY_BASE_URL: 'https://registry.invalid',
  COMPANY_REGISTRY_TIMEOUT_MS: 1_000,
  SERPRO_AUTH_URL: 'https://serpro-auth.invalid/authenticate',
  SERPRO_API_BASE_URL: 'https://serpro-api.invalid/integra-contador/v1',
  SERPRO_TIMEOUT_MS: 1_000,
  ECAC_WORKER_POLL_INTERVAL_MS: 30_000,
  ECAC_WORKER_BATCH_SIZE: 25,
  ECAC_WORKER_LOCK_TTL_MS: 600_000,
  ECAC_NOTIFICATION_WORKER_POLL_INTERVAL_MS: 30_000,
  ECAC_NOTIFICATION_WORKER_BATCH_SIZE: 25,
  ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS: 600_000,
  ECAC_NOTIFICATION_RETRY_DELAY_MS: 300_000,
  ECAC_EMAIL_PROVIDER: 'disabled',
  ECAC_EMAIL_HTTP_URL: '',
  ECAC_EMAIL_HTTP_AUTHORIZATION: '',
  ECAC_EMAIL_FROM: '',
  ECAC_EMAIL_SUBJECT_PREFIX: '[API Fiscal]',
  ECAC_EMAIL_TIMEOUT_MS: 10_000,
};

const registryData: CompanyRegistryData = {
  cnpj: '11222333000181',
  legalName: 'Empresa Integração Ltda.',
  tradeName: 'Empresa Integração',
  registrationStatus: 'ACTIVE',
  openingDate: new Date('2020-01-02T00:00:00.000Z'),
  primaryCnae: '6201501',
  primaryCnaeDescription: 'Desenvolvimento de programas de computador',
  municipality: 'Joinville',
  state: 'SC',
  source: 'BRASIL_API',
  consultedAt: new Date('2026-07-25T00:00:00.000Z'),
};

const registryGateway: CompanyRegistryGateway = {
  lookup: async () => registryData,
};

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  session: {
    tenantId: string;
    userId: string;
    membershipId: string;
  };
}

interface MfaSetupResponse {
  status: 'MFA_SETUP_REQUIRED';
  challengeToken: string;
  secret: string;
}

async function cleanDatabase(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.ecacAlertNotificationEvent.deleteMany();
  await prisma.ecacAlertNotificationPreference.deleteMany();
  await prisma.ecacObservationCursor.deleteMany();
  await prisma.ecacAlert.deleteMany();
  await prisma.ecacFinding.deleteMany();
  await prisma.ecacSitfisProcess.deleteMany();
  await prisma.ecacSyncJob.deleteMany();
  await prisma.ecacSyncBatch.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.mfaChallenge.deleteMany();
  await prisma.mfaRecoveryCode.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.credentialAlert.deleteMany();
  await prisma.powerOfAttorney.deleteMany();
  await prisma.companyResponsible.deleteMany();
  await prisma.serproConnection.deleteMany();
  await prisma.certificateCompanyScope.deleteMany();
  await prisma.digitalCertificate.deleteMany();
  await prisma.company.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

async function createTestApp(
  applicationEnv: Env = env,
  ecacGateway?: EcacGateway,
) {
  const container = createApplicationContainer(applicationEnv, prisma);
  container.register({
    companyRegistryGateway: asValue(registryGateway),
    ...(ecacGateway ? { ecacGateway: asValue(ecacGateway) } : {}),
  });
  return buildApp({ env: applicationEnv, container });
}

async function registerOwner(
  app: Awaited<ReturnType<typeof createTestApp>>,
  suffix: string,
): Promise<AuthResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      tenantName: `Escritório ${suffix}`,
      tenantSlug: `escritorio-${suffix.toLowerCase()}`,
      userName: `Proprietário ${suffix}`,
      email: `owner-${suffix.toLowerCase()}@example.com`,
      password: testPassword,
    },
  });

  expect(response.statusCode).toBe(201);
  const setup = response.json<MfaSetupResponse>();
  expect(setup.status).toBe('MFA_SETUP_REQUIRED');

  const verification = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/verify',
    payload: {
      challengeToken: setup.challengeToken,
      code: generateTotpCode(setup.secret),
    },
  });

  expect(verification.statusCode).toBe(200);
  expect(verification.json()).toMatchObject({
    recoveryCodes: expect.any(Array),
  });
  return verification.json<AuthResponse>();
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe('autenticação e isolamento multiempresa', () => {
  it('impede que um escritório consulte a empresa pertencente a outro', async () => {
    const app = await createTestApp();
    const tenantA = await registerOwner(app, 'A');
    const tenantB = await registerOwner(app, 'B');

    const companyAResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { cnpj: registryData.cnpj },
    });
    const companyBResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
      payload: { cnpj: registryData.cnpj },
    });

    expect(companyAResponse.statusCode).toBe(201);
    expect(companyBResponse.statusCode).toBe(201);

    const companyA = companyAResponse.json<{ id: string; tenantId: string }>();
    const companyB = companyBResponse.json<{ id: string; tenantId: string }>();
    expect(companyA.tenantId).toBe(tenantA.session.tenantId);
    expect(companyB.tenantId).toBe(tenantB.session.tenantId);
    expect(companyA.id).not.toBe(companyB.id);

    const crossTenantRead = await app.inject({
      method: 'GET',
      url: `/v1/control/companies/${companyA.id}`,
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const ownerRead = await app.inject({
      method: 'GET',
      url: `/v1/control/companies/${companyA.id}`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });

    expect(crossTenantRead.statusCode).toBe(404);
    expect(ownerRead.statusCode).toBe(200);

    await app.close();
  });

  it('rotaciona refresh token e revoga a família quando o token antigo é reutilizado', async () => {
    const app = await createTestApp();
    const auth = await registerOwner(app, 'Rotacao');

    const rotation = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: auth.refreshToken },
    });

    expect(rotation.statusCode).toBe(200);
    const rotated = rotation.json<AuthResponse>();
    expect(rotated.refreshToken).not.toBe(auth.refreshToken);

    const reuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: auth.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({
      error: { code: 'REFRESH_TOKEN_REUSED' },
    });

    const revokedFamily = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(revokedFamily.statusCode).toBe(401);
    expect(revokedFamily.json()).toMatchObject({
      error: { code: 'REFRESH_TOKEN_REVOKED' },
    });

    await app.close();
  });

  it('redefine a senha e invalida imediatamente access e refresh tokens anteriores', async () => {
    const app = await createTestApp();
    const auth = await registerOwner(app, 'Recuperacao');

    const requestReset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email: 'owner-recuperacao@example.com' },
    });
    expect(requestReset.statusCode).toBe(202);
    const recoveryToken = requestReset.json<{ recoveryToken: string }>().recoveryToken;

    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: {
        token: recoveryToken,
        password: replacementTestPassword,
      },
    });
    expect(reset.statusCode).toBe(204);

    const staleAccess = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(staleAccess.statusCode).toBe(401);
    expect(staleAccess.json()).toMatchObject({
      error: { code: 'ACCESS_REVOKED' },
    });

    const staleRefresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: auth.refreshToken },
    });
    expect(staleRefresh.statusCode).toBe(401);
    expect(staleRefresh.json()).toMatchObject({
      error: { code: 'REFRESH_TOKEN_REVOKED' },
    });

    await app.close();
  });

  it('cifra o A1 e impede consulta do certificado por outro escritório', async () => {
    const app = await createTestApp();
    const tenantA = await registerOwner(app, 'CofreA');
    const tenantB = await registerOwner(app, 'CofreB');
    const companyResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { cnpj: registryData.cnpj },
    });
    expect(companyResponse.statusCode).toBe(201);
    const company = companyResponse.json<{ id: string }>();
    const fixture = createTestPkcs12();

    const upload = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/certificates/a1',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        label: 'A1 principal',
        pfxBase64: fixture.base64,
        password: fixture.password,
        companyIds: [company.id],
      },
    });

    expect(upload.statusCode).toBe(201);
    const certificate = upload.json<{
      id: string;
      subjectCommonName: string;
      lifecycle: string;
      encryptedBundle?: string;
      encryptedPassword?: string;
      password?: string;
      pfxBase64?: string;
    }>();
    expect(certificate).toMatchObject({
      subjectCommonName: fixture.subjectCommonName,
      lifecycle: 'ACTIVE',
    });
    expect(certificate.encryptedBundle).toBeUndefined();
    expect(certificate.encryptedPassword).toBeUndefined();
    expect(certificate.password).toBeUndefined();
    expect(certificate.pfxBase64).toBeUndefined();

    const stored = await prisma.digitalCertificate.findUniqueOrThrow({
      where: { id: certificate.id },
    });
    expect(stored.encryptedBundle).not.toContain(fixture.base64);
    expect(stored.encryptedPassword).not.toContain(fixture.password);
    expect(stored.keyVersion).toBe(1);

    await app.close();

    const rotatingApp = await createTestApp({
      ...env,
      CREDENTIAL_VAULT_MASTER_KEY: randomBytes(32).toString('base64'),
      CREDENTIAL_VAULT_KEY_VERSION: 2,
      CREDENTIAL_VAULT_PREVIOUS_KEYS: JSON.stringify({
        1: env.CREDENTIAL_VAULT_MASTER_KEY,
      }),
    });
    const rotation = await rotatingApp.inject({
      method: 'POST',
      url: '/v1/control/credentials/certificates/rotate-key',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { limit: 10 },
    });
    expect(rotation.statusCode).toBe(200);
    expect(rotation.json()).toMatchObject({
      targetKeyVersion: 2,
      scanned: 1,
      rotated: 1,
      hasMore: false,
    });

    const rotatedStored = await prisma.digitalCertificate.findUniqueOrThrow({
      where: { id: certificate.id },
    });
    expect(rotatedStored.keyVersion).toBe(2);
    expect(rotatedStored.encryptedBundle).not.toBe(stored.encryptedBundle);
    expect(rotatedStored.encryptedPassword).not.toBe(stored.encryptedPassword);
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          entityId: certificate.id,
          action: 'credential.certificate.key_rotated',
        },
      }),
    ).resolves.toMatchObject({
      tenantId: tenantA.session.tenantId,
      actorId: tenantA.session.userId,
    });

    const crossTenantRead = await rotatingApp.inject({
      method: 'GET',
      url: `/v1/control/credentials/certificates/${certificate.id}`,
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    expect(crossTenantRead.statusCode).toBe(404);
    expect(crossTenantRead.json()).toMatchObject({
      error: { code: 'CERTIFICATE_NOT_FOUND' },
    });

    await rotatingApp.close();
  });

  it('cifra a conexão SERPRO e impede uso de certificado de outro escritório', async () => {
    const app = await createTestApp();
    const tenantA = await registerOwner(app, 'SerproA');
    const tenantB = await registerOwner(app, 'SerproB');

    const companyResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { cnpj: registryData.cnpj },
    });
    expect(companyResponse.statusCode).toBe(201);
    const company = companyResponse.json<{ id: string }>();

    const fixture = createTestPkcs12();
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/certificates/a1',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        label: 'A1 Contratante SERPRO',
        pfxBase64: fixture.base64,
        password: fixture.password,
        companyIds: [company.id],
      },
    });
    expect(upload.statusCode).toBe(201);
    const certificate = upload.json<{ id: string }>();
    const consumerKey = `key-${randomBytes(18).toString('base64url')}`;
    const consumerSecret = `secret-${randomBytes(24).toString('base64url')}`;

    const configured = await app.inject({
      method: 'PUT',
      url: '/v1/control/ecac/serpro-connection',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        certificateId: certificate.id,
        contractorCnpj: registryData.cnpj,
        requesterCnpj: registryData.cnpj,
        consumerKey,
        consumerSecret,
      },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({
      tenantId: tenantA.session.tenantId,
      certificateId: certificate.id,
      contractorCnpj: registryData.cnpj,
      status: 'ACTIVE',
    });
    expect(configured.json().consumerKey).toBeUndefined();
    expect(configured.json().consumerSecret).toBeUndefined();

    const stored = await prisma.serproConnection.findUniqueOrThrow({
      where: { tenantId: tenantA.session.tenantId },
    });
    expect(stored.encryptedConsumerKey).not.toContain(consumerKey);
    expect(stored.encryptedConsumerSecret).not.toContain(consumerSecret);

    const ownRead = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/serpro-connection',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    const crossTenantRead = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/serpro-connection',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const crossTenantConfigure = await app.inject({
      method: 'PUT',
      url: '/v1/control/ecac/serpro-connection',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
      payload: {
        certificateId: certificate.id,
        contractorCnpj: registryData.cnpj,
        requesterCnpj: registryData.cnpj,
        consumerKey,
        consumerSecret,
      },
    });
    expect(ownRead.statusCode).toBe(200);
    expect(crossTenantRead.statusCode).toBe(404);
    expect(crossTenantConfigure.statusCode).toBe(404);

    await app.close();
  });

  it('isola responsáveis e procurações e deduplica alertas de validade', async () => {
    const app = await createTestApp();
    const tenantA = await registerOwner(app, 'AutoridadeA');
    const tenantB = await registerOwner(app, 'AutoridadeB');
    const companyResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { cnpj: registryData.cnpj },
    });
    expect(companyResponse.statusCode).toBe(201);
    const company = companyResponse.json<{ id: string }>();

    const assignment = await app.inject({
      method: 'POST',
      url: `/v1/control/credentials/companies/${company.id}/responsibles`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        membershipId: tenantA.session.membershipId,
        role: 'PRIMARY',
      },
    });
    expect(assignment.statusCode).toBe(201);
    const responsible = assignment.json<{ id: string }>();

    const now = Date.now();
    const createPower = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/powers-of-attorney',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        companyId: company.id,
        responsibleId: responsible.id,
        label: 'Procuração e-CAC',
        externalReference: 'INT-POA-001',
        services: ['ECAC', 'DCTFWEB'],
        validFrom: new Date(now - 24 * 60 * 60 * 1_000)
          .toISOString()
          .slice(0, 10),
        validUntil: new Date(now + 6 * 24 * 60 * 60 * 1_000)
          .toISOString()
          .slice(0, 10),
      },
    });
    expect(createPower.statusCode).toBe(201);
    expect(createPower.json()).toMatchObject({
      companyId: company.id,
      responsibleId: responsible.id,
      lifecycle: 'ACTIVE',
    });

    const crossTenantCreate = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/powers-of-attorney',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
      payload: {
        companyId: company.id,
        responsibleId: responsible.id,
        label: 'Tentativa cruzada',
        services: ['ECAC'],
        validFrom: new Date(now).toISOString().slice(0, 10),
        validUntil: new Date(now + 30 * 24 * 60 * 60 * 1_000)
          .toISOString()
          .slice(0, 10),
      },
    });
    expect(crossTenantCreate.statusCode).toBe(404);

    const firstScan = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/alerts/scan',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    const repeatedScan = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/alerts/scan',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(firstScan.statusCode).toBe(200);
    expect(firstScan.json()).toEqual({ scanned: 1, created: 1 });
    expect(repeatedScan.json()).toEqual({ scanned: 1, created: 0 });

    const alerts = await app.inject({
      method: 'GET',
      url: '/v1/control/credentials/alerts?status=OPEN',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    const otherTenantAlerts = await app.inject({
      method: 'GET',
      url: '/v1/control/credentials/alerts',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.json()).toEqual([
      expect.objectContaining({
        sourceType: 'POWER_OF_ATTORNEY',
        sourceLabel: 'Procuração e-CAC',
        kind: 'EXPIRING',
        thresholdDays: 7,
      }),
    ]);
    expect(otherTenantAlerts.json()).toEqual([]);

    await app.close();
  });

  it('adquire o lock transacional do Radar sem retornar void ao Prisma', async () => {
    await prisma.$transaction(async (transaction) => {
      await acquireEcacStreamLock(transaction, 'integration:ecac-advisory-lock');
    });
  });

  it('processa Radar e-CAC de forma idempotente e mantém lotes isolados', async () => {
    const sitfisReportHash = 'd'.repeat(64);
    let gatewayCalls = 0;
    let findingMode: 'ORIGINAL' | 'CHANGED' | 'EMPTY' = 'ORIGINAL';
    const ecacGateway: EcacGateway = {
      query: async (input) => {
        gatewayCalls += 1;
        if (gatewayCalls === 1) {
          return {
            state: 'DEFERRED',
            provider: 'SERPRO_INTEGRA_CONTADOR',
            resumeAt: new Date(Date.now() + 60_000),
            providerStatus: 202,
          };
        }
        return {
          state: 'COMPLETED',
          provider: 'SERPRO_INTEGRA_CONTADOR',
          protocol: `PROTOCOLO-${input.companyCnpj}`,
          fetchedAt: new Date(),
          payload: { situation: 'PENDING', companyCnpj: input.companyCnpj },
          artifactHash: sitfisReportHash,
          findings:
            findingMode === 'EMPTY'
              ? []
              : [
                  {
                    code: 'PENDING_DEBT',
                    category: 'DEBT',
                    title:
                      findingMode === 'CHANGED'
                        ? 'Débito pendente atualizado'
                        : 'Débito pendente',
                    description:
                      findingMode === 'CHANGED'
                        ? 'Pendência reclassificada pelo adaptador.'
                        : 'Pendência retornada pelo adaptador de integração.',
                    severity: findingMode === 'CHANGED' ? 'WARNING' : 'CRITICAL',
                    sourceReference: 'DEBT-001',
                    observedAt: new Date(),
                  },
                ],
        };
      },
    };
    const app = await createTestApp(env, ecacGateway);
    const tenantA = await registerOwner(app, 'RadarA');
    const tenantB = await registerOwner(app, 'RadarB');

    const companyResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { cnpj: registryData.cnpj },
    });
    expect(companyResponse.statusCode).toBe(201);
    const company = companyResponse.json<{ id: string }>();

    const fixture = createTestPkcs12();
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/certificates/a1',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        label: 'A1 Radar',
        pfxBase64: fixture.base64,
        password: fixture.password,
        companyIds: [company.id],
      },
    });
    expect(upload.statusCode).toBe(201);
    const certificate = upload.json<{ id: string }>();

    const assignment = await app.inject({
      method: 'POST',
      url: `/v1/control/credentials/companies/${company.id}/responsibles`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        membershipId: tenantA.session.membershipId,
        role: 'PRIMARY',
      },
    });
    expect(assignment.statusCode).toBe(201);
    const responsible = assignment.json<{ id: string }>();

    const now = Date.now();
    const powerResponse = await app.inject({
      method: 'POST',
      url: '/v1/control/credentials/powers-of-attorney',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        companyId: company.id,
        responsibleId: responsible.id,
        certificateId: certificate.id,
        label: 'Procuração Radar e-CAC',
        services: ['ECAC'],
        validFrom: new Date(now - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
        validUntil: new Date(now + 30 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
      },
    });
    expect(powerResponse.statusCode).toBe(201);
    const power = powerResponse.json<{ id: string }>();

    const notificationPreference = await app.inject({
      method: 'PUT',
      url: '/v1/control/ecac/notification-preferences/IN_APP',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: {
        enabled: true,
        minimumSeverity: 'WARNING',
        includeResolved: true,
      },
    });
    expect(notificationPreference.statusCode).toBe(200);
    expect(notificationPreference.json()).toMatchObject({
      channel: 'IN_APP',
      enabled: true,
      minimumSeverity: 'WARNING',
      includeResolved: true,
    });

    const payload = {
      requestKey: 'integration-radar-001',
      queryType: 'TAX_STATUS',
      targets: [{ companyId: company.id, powerOfAttorneyId: power.id }],
    };
    const firstRequest = await app.inject({
      method: 'POST',
      url: '/v1/control/ecac/sync-batches',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload,
    });
    const repeatedRequest = await app.inject({
      method: 'POST',
      url: '/v1/control/ecac/sync-batches',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload,
    });
    expect(firstRequest.statusCode).toBe(202);
    expect(repeatedRequest.statusCode).toBe(202);
    const firstBatch = firstRequest.json<{ id: string; status: string }>();
    expect(repeatedRequest.json<{ id: string }>().id).toBe(firstBatch.id);
    expect(await prisma.ecacSyncBatch.count()).toBe(1);
    expect(await prisma.ecacSyncJob.count()).toBe(1);
    const queuedJob = await prisma.ecacSyncJob.findFirstOrThrow({
      where: { batchId: firstBatch.id },
    });
    await prisma.ecacSitfisProcess.create({
      data: {
        tenantId: tenantA.session.tenantId,
        jobId: queuedJob.id,
        companyId: company.id,
        status: 'AWAITING_REPORT',
        encryptedProtocol: 'test-only-encrypted-protocol',
        protocolKeyVersion: 1,
        protocolHash: 'c'.repeat(64),
        nextAttemptAt: new Date(),
        providerStatus: 202,
      },
    });

    const deferredProcess = await app.inject({
      method: 'POST',
      url: '/v1/control/ecac/jobs/process',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
      payload: { limit: 10 },
    });
    expect(deferredProcess.statusCode).toBe(200);
    expect(deferredProcess.json()).toEqual({
      claimed: 1,
      succeeded: 0,
      deferred: 1,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
    });
    const deferredJob = await prisma.ecacSyncJob.findUniqueOrThrow({
      where: { id: queuedJob.id },
    });
    expect(deferredJob).toMatchObject({
      status: 'RETRY_SCHEDULED',
      attemptCount: 0,
      provider: 'SERPRO_INTEGRA_CONTADOR',
      errorCode: null,
    });
    await prisma.ecacSyncJob.update({
      where: { id: queuedJob.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });

    const workerContainer = createApplicationContainer(env, prisma);
    workerContainer.register({
      ecacGateway: asValue(ecacGateway),
    });
    const completedProcess =
      await workerContainer.cradle.processEcacJobsUseCase.executeScheduled(
        env.ECAC_WORKER_BATCH_SIZE,
        env.ECAC_WORKER_LOCK_TTL_MS,
      );
    expect(completedProcess).toEqual({
      claimed: 1,
      succeeded: 1,
      deferred: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
    });

    const completed = await app.inject({
      method: 'GET',
      url: `/v1/control/ecac/sync-batches/${firstBatch.id}`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: 'SUCCEEDED',
      succeededJobs: 1,
      failedJobs: 0,
      jobs: [
        {
          status: 'SUCCEEDED',
          provider: 'SERPRO_INTEGRA_CONTADOR',
          protocol: `PROTOCOLO-${registryData.cnpj}`,
          findings: [{ code: 'PENDING_DEBT', severity: 'CRITICAL' }],
        },
      ],
    });
    const completedSitfis = await prisma.ecacSitfisProcess.findUniqueOrThrow({
      where: { jobId: queuedJob.id },
    });
    expect(completedSitfis).toMatchObject({
      status: 'COMPLETED',
      encryptedProtocol: null,
      protocolKeyVersion: null,
      protocolHash: 'c'.repeat(64),
      reportHash: sitfisReportHash,
      completedAt: expect.any(Date),
    });

    const firstAlerts = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/alerts?status=OPEN',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(firstAlerts.statusCode).toBe(200);
    expect(firstAlerts.json()).toEqual([
      expect.objectContaining({
        companyId: company.id,
        queryType: 'TAX_STATUS',
        code: 'PENDING_DEBT',
        severity: 'CRITICAL',
        status: 'OPEN',
        lastChangeType: 'NEW',
      }),
    ]);
    const alertId = firstAlerts.json<Array<{ id: string }>>()[0]!.id;

    const firstEvents = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/notification-events?status=PENDING',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(firstEvents.statusCode).toBe(200);
    expect(firstEvents.json()).toEqual([
      expect.objectContaining({
        alertId,
        userId: tenantA.session.userId,
        companyId: company.id,
        channel: 'IN_APP',
        status: 'PENDING',
        changeType: 'NEW',
        severity: 'CRITICAL',
        title: 'Débito pendente',
      }),
    ]);
    const firstEventId = firstEvents.json<Array<{ id: string }>>()[0]!.id;
    const firstEventDetail = await app.inject({
      method: 'GET',
      url: `/v1/control/ecac/notification-events/${firstEventId}`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(firstEventDetail.statusCode).toBe(200);
    expect(firstEventDetail.json()).toMatchObject({
      id: firstEventId,
      alertId,
      userId: tenantA.session.userId,
      companyId: company.id,
      channel: 'IN_APP',
      status: 'PENDING',
      changeType: 'NEW',
      severity: 'CRITICAL',
    });
    const notificationProcess =
      await workerContainer.cradle.processEcacNotificationEventsUseCase.executeScheduled(
        env.ECAC_NOTIFICATION_WORKER_BATCH_SIZE,
        env.ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS,
      );
    expect(notificationProcess).toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      retryScheduled: 0,
      missing: 0,
    });
    const deliveredEvent = await prisma.ecacAlertNotificationEvent.findUniqueOrThrow({
      where: {
        tenantId_id: {
          tenantId: tenantA.session.tenantId,
          id: firstEventId,
        },
      },
    });
    expect(deliveredEvent).toMatchObject({
      id: firstEventId,
      status: 'DELIVERED',
      attemptCount: 1,
      processingStartedAt: null,
      deliveredAt: expect.any(Date),
    });
    const deliveredSummary = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/notification-events/summary',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(deliveredSummary.statusCode).toBe(200);
    expect(deliveredSummary.json()).toMatchObject({
      total: 1,
      byStatus: {
        PENDING: 0,
        PROCESSING: 0,
        DELIVERED: 1,
        FAILED: 0,
      },
      byChannel: {
        IN_APP: 1,
        EMAIL: 0,
      },
      nextPendingAt: null,
      lastDeliveredAt: expect.any(String),
      lastFailedAt: null,
      lastFailureCode: null,
    });
    const failedAt = new Date();
    await prisma.ecacAlertNotificationEvent.update({
      where: {
        tenantId_id: {
          tenantId: tenantA.session.tenantId,
          id: firstEventId,
        },
      },
      data: {
        status: 'FAILED',
        deliveredAt: null,
        failedAt,
        failureCode: 'HTTP_503',
      },
    });
    const retryEvent = await app.inject({
      method: 'POST',
      url: `/v1/control/ecac/notification-events/${firstEventId}/retry`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(retryEvent.statusCode).toBe(200);
    expect(retryEvent.json()).toMatchObject({
      id: firstEventId,
      status: 'PENDING',
      attemptCount: 1,
      failedAt: null,
      failureCode: null,
    });
    const retriedEvent = await prisma.ecacAlertNotificationEvent.findUniqueOrThrow({
      where: {
        tenantId_id: {
          tenantId: tenantA.session.tenantId,
          id: firstEventId,
        },
      },
    });
    expect(retriedEvent).toMatchObject({
      status: 'PENDING',
      attemptCount: 1,
      processingStartedAt: null,
      deliveredAt: null,
      failedAt: null,
      failureCode: null,
    });
    expect(retriedEvent.scheduledAt.getTime()).toBeGreaterThanOrEqual(
      failedAt.getTime(),
    );
    const retryAgain = await app.inject({
      method: 'POST',
      url: `/v1/control/ecac/notification-events/${firstEventId}/retry`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(retryAgain.statusCode).toBe(409);

    const acknowledged = await app.inject({
      method: 'POST',
      url: `/v1/control/ecac/alerts/${alertId}/acknowledge`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json()).toMatchObject({
      id: alertId,
      status: 'ACKNOWLEDGED',
      acknowledgedById: tenantA.session.userId,
    });

    async function observeAgain(
      requestKey: string,
    ): Promise<void> {
      const request = await app.inject({
        method: 'POST',
        url: '/v1/control/ecac/sync-batches',
        headers: { authorization: `Bearer ${tenantA.accessToken}` },
        payload: {
          ...payload,
          requestKey,
        },
      });
      expect(request.statusCode).toBe(202);
      const nextBatch = request.json<{ id: string }>();
      const nextJob = await prisma.ecacSyncJob.findFirstOrThrow({
        where: { batchId: nextBatch.id },
      });
      await prisma.ecacSitfisProcess.create({
        data: {
          tenantId: tenantA.session.tenantId,
          jobId: nextJob.id,
          companyId: company.id,
          status: 'AWAITING_REPORT',
          encryptedProtocol: 'test-only-encrypted-protocol',
          protocolKeyVersion: 1,
          protocolHash: 'c'.repeat(64),
          nextAttemptAt: new Date(),
          providerStatus: 202,
        },
      });
      const processed = await app.inject({
        method: 'POST',
        url: '/v1/control/ecac/jobs/process',
        headers: { authorization: `Bearer ${tenantA.accessToken}` },
        payload: { limit: 10 },
      });
      expect(processed.statusCode).toBe(200);
      expect(processed.json()).toMatchObject({ claimed: 1, succeeded: 1 });
    }

    findingMode = 'CHANGED';
    await observeAgain('integration-radar-002');
    const changedAlerts = await app.inject({
      method: 'GET',
      url: `/v1/control/ecac/alerts?companyId=${company.id}`,
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(changedAlerts.json()).toEqual([
      expect.objectContaining({
        id: alertId,
        severity: 'WARNING',
        status: 'OPEN',
        lastChangeType: 'CHANGED',
        acknowledgedAt: null,
        acknowledgedById: null,
      }),
    ]);
    const changedEvents = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/notification-events?status=PENDING',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(changedEvents.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alertId,
          channel: 'IN_APP',
          status: 'PENDING',
          changeType: 'CHANGED',
          severity: 'WARNING',
        }),
      ]),
    );

    findingMode = 'EMPTY';
    await observeAgain('integration-radar-003');
    const resolvedAlerts = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/alerts?status=RESOLVED',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(resolvedAlerts.json()).toEqual([
      expect.objectContaining({
        id: alertId,
        status: 'RESOLVED',
        lastChangeType: 'RESOLVED',
        resolvedAt: expect.any(String),
      }),
    ]);

    findingMode = 'ORIGINAL';
    await observeAgain('integration-radar-004');
    const reopenedAlerts = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/alerts?status=OPEN',
      headers: { authorization: `Bearer ${tenantA.accessToken}` },
    });
    expect(reopenedAlerts.json()).toEqual([
      expect.objectContaining({
        id: alertId,
        severity: 'CRITICAL',
        status: 'OPEN',
        lastChangeType: 'REOPENED',
        resolvedAt: null,
      }),
    ]);

    const crossTenantRead = await app.inject({
      method: 'GET',
      url: `/v1/control/ecac/sync-batches/${firstBatch.id}`,
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const otherTenantFindings = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/findings',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const otherTenantAlerts = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/alerts',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const otherTenantEvents = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/notification-events',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const otherTenantEventDetail = await app.inject({
      method: 'GET',
      url: `/v1/control/ecac/notification-events/${firstEventId}`,
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    const otherTenantEventSummary = await app.inject({
      method: 'GET',
      url: '/v1/control/ecac/notification-events/summary',
      headers: { authorization: `Bearer ${tenantB.accessToken}` },
    });
    expect(crossTenantRead.statusCode).toBe(404);
    expect(otherTenantFindings.json()).toEqual([]);
    expect(otherTenantAlerts.json()).toEqual([]);
    expect(otherTenantEvents.json()).toEqual([]);
    expect(otherTenantEventDetail.statusCode).toBe(404);
    expect(otherTenantEventSummary.json()).toEqual({
      total: 0,
      byStatus: {
        PENDING: 0,
        PROCESSING: 0,
        DELIVERED: 0,
        FAILED: 0,
      },
      byChannel: {
        IN_APP: 0,
        EMAIL: 0,
      },
      nextPendingAt: null,
      lastDeliveredAt: null,
      lastFailedAt: null,
      lastFailureCode: null,
    });

    await app.close();
  });
});
