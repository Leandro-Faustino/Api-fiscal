import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { AwilixContainer } from 'awilix';
import type { Env } from './config/env.js';
import type { Cradle } from './shared/container.js';
import { companyRoutes } from './modules/control/companies/presentation/company-routes.js';
import { registerErrorHandler } from './shared/infra/http/error-handler.js';

interface BuildAppOptions {
  env: Env;
  container: AwilixContainer<Cradle>;
}

export async function buildApp({ env, container }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'API Fiscal',
        description: 'API da plataforma de gestão fiscal e inteligência contábil.',
        version: '0.1.0',
      },
      tags: [
        {
          name: 'Control - Empresas',
          description: 'Cadastro automático de empresas do plano Control (F52).',
        },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  registerErrorHandler(app);

  app.get(
    '/health',
    {
      schema: {
        tags: ['Infraestrutura'],
        summary: 'Verificar disponibilidade da API',
        response: {
          200: {
            type: 'object',
            required: ['status', 'timestamp'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
  );

  await companyRoutes(app, container.cradle);

  app.addHook('onClose', async () => {
    await container.dispose();
  });

  return app;
}
