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
  LOG_LEVEL: 'silent',
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
  await prisma.company.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

async function createTestApp() {
  const container = createApplicationContainer(env, prisma);
  container.register({
    companyRegistryGateway: asValue(registryGateway),
  });
  return buildApp({ env, container });
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
});
