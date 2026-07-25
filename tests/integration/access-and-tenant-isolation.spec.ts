import { asValue } from 'awilix';
import { PrismaClient } from '@prisma/client';
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

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3333,
  LOG_LEVEL: 'error',
  DATABASE_URL: databaseUrl,
  JWT_SECRET: 'integration-secret-with-at-least-32-characters',
  JWT_ISSUER: 'api-fiscal-integration',
  JWT_AUDIENCE: 'api-fiscal-integration-client',
  JWT_EXPIRES_IN: '15m',
  REFRESH_TOKEN_TTL_DAYS: 30,
  AUTH_RATE_LIMIT_MAX: 100,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
  ENABLE_SWAGGER_UI: false,
  MFA_ENCRYPTION_KEY: 'integration-mfa-encryption-key-32-characters',
  CREDENTIAL_VAULT_MASTER_KEY: Buffer.alloc(32, 13).toString('base64'),
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
  await prisma.refreshSession.deleteMany();
  await prisma.mfaChallenge.deleteMany();
  await prisma.mfaRecoveryCode.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.credentialAlert.deleteMany();
  await prisma.powerOfAttorney.deleteMany();
  await prisma.companyResponsible.deleteMany();
  await prisma.certificateCompanyScope.deleteMany();
  await prisma.digitalCertificate.deleteMany();
  await prisma.company.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

async function createTestApp(applicationEnv: Env = env) {
  const container = createApplicationContainer(applicationEnv, prisma);
  container.register({
    companyRegistryGateway: asValue(registryGateway),
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
      password: 'SenhaSegura123',
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
        password: 'OutraSenhaSegura123',
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
      CREDENTIAL_VAULT_MASTER_KEY: Buffer.alloc(32, 14).toString('base64'),
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
});
