import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import type { Env } from '../../../config/env.js';
import { createApplicationContainer } from '../../container.js';
import { prisma } from '../database/prisma-client.js';

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
});
