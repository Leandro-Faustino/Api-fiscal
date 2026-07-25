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
    const protectedRoute = await app.inject({
      method: 'POST',
      url: '/v1/control/companies',
      payload: { cnpj: '11222333000181' },
    });

    expect(health.statusCode).toBe(200);
    expect(docs.statusCode).toBe(200);
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
});
