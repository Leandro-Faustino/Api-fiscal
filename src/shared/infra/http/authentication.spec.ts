import { afterAll, describe, expect, it } from 'vitest';
import { asValue } from 'awilix';
import { buildApp } from '../../../app.js';
import type { Env } from '../../../config/env.js';
import { createApplicationContainer } from '../../container.js';
import { prisma } from '../database/prisma-client.js';
import { FakeAccessRepository } from '../../../modules/access/tests/fakes.js';

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3333,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/api_fiscal_test',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  JWT_ISSUER: 'api-fiscal-test',
  JWT_AUDIENCE: 'api-fiscal-test-client',
  JWT_EXPIRES_IN: '15m',
  REFRESH_TOKEN_TTL_DAYS: 30,
  AUTH_RATE_LIMIT_MAX: 100,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
  ENABLE_SWAGGER_UI: true,
  MFA_ENCRYPTION_KEY: 'test-mfa-encryption-key-with-32-characters',
  CREDENTIAL_VAULT_MASTER_KEY: Buffer.alloc(32, 11).toString('base64'),
  CREDENTIAL_VAULT_KEY_VERSION: 1,
  CREDENTIAL_VAULT_PREVIOUS_KEYS: '{}',
  MFA_ISSUER: 'API Fiscal Test',
  MFA_CHALLENGE_TTL_MINUTES: 5,
  MFA_MAXIMUM_ATTEMPTS: 5,
  PASSWORD_RESET_TTL_MINUTES: 15,
  EXPOSE_RECOVERY_TOKENS: true,
  INVITATION_TTL_HOURS: 72,
  COMPANY_REGISTRY_BASE_URL: 'https://brasilapi.com.br/api/cnpj/v1',
  COMPANY_REGISTRY_TIMEOUT_MS: 5_000,
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe('fronteira HTTP autenticada', () => {
  it('mantém infraestrutura pública e bloqueia empresas sem token', async () => {
    const container = createApplicationContainer(env, prisma);
    const app = await buildApp({ env, container });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const docs = await app.inject({ method: 'GET', url: '/docs/json' });
    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    const protectedRoute = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      payload: { cnpj: '11222333000181' },
    });

    expect(health.statusCode).toBe(200);
    expect(docs.statusCode).toBe(200);
    expect(openApi.statusCode).toBe(200);
    expect(openApi.json().paths).toHaveProperty(
      '/v1/control/credentials/certificates/a1',
    );
    expect(openApi.json().paths).toHaveProperty(
      '/v1/control/credentials/certificates/rotate-key',
    );
    expect(protectedRoute.statusCode).toBe(401);
    expect(protectedRoute.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });

    await app.close();
  });

  it('limita tentativas repetidas nas rotas públicas de autenticação', async () => {
    const container = createApplicationContainer(
      { ...env, AUTH_RATE_LIMIT_MAX: 2 },
      prisma,
    );
    container.register({
      accessRepository: asValue(new FakeAccessRepository()),
    });
    const app = await buildApp({
      env: { ...env, AUTH_RATE_LIMIT_MAX: 2 },
      container,
    });
    const request = {
      method: 'POST' as const,
      url: '/v1/auth/login',
      payload: {
        tenantSlug: 'escritorio-teste',
        email: 'owner@example.com',
        password: 'incorreta',
      },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);
    const blocked = await app.inject(request);

    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(401);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    });

    await app.close();
  });

  it('rejeita JWT legado sem versão de segurança', async () => {
    const container = createApplicationContainer(env, prisma);
    container.register({
      accessRepository: asValue(new FakeAccessRepository()),
    });
    const app = await buildApp({ env, container });
    const legacyToken = app.jwt.sign({
      sub: '10000000-0000-4000-8000-000000000001',
      membershipId: '20000000-0000-4000-8000-000000000001',
      tenantId: '30000000-0000-4000-8000-000000000001',
      role: 'OWNER',
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${legacyToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'ACCESS_REVOKED' },
    });

    await app.close();
  });

  it('não registra o Swagger UI em produção e mantém o OpenAPI JSON', async () => {
    const productionEnv: Env = {
      ...env,
      NODE_ENV: 'production',
      ENABLE_SWAGGER_UI: false,
      EXPOSE_RECOVERY_TOKENS: false,
    };
    const container = createApplicationContainer(productionEnv, prisma);
    const app = await buildApp({ env: productionEnv, container });

    const swaggerUi = await app.inject({ method: 'GET', url: '/docs/json' });
    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });

    expect(swaggerUi.statusCode).toBe(404);
    expect(openApi.statusCode).toBe(200);

    await app.close();
  });
});
