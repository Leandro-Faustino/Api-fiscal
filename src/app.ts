import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { AwilixContainer } from 'awilix';
import type { Env } from './config/env.js';
import type { Cradle } from './shared/container.js';
import { companyRoutes } from './modules/control/companies/presentation/company-routes.js';
import { registerErrorHandler } from './shared/infra/http/error-handler.js';
import { accessRoutes } from './modules/access/presentation/access-routes.js';
import { registerAuthentication } from './shared/infra/http/authentication.js';
import { digitalCertificateRoutes } from './modules/credentials/presentation/digital-certificate-routes.js';
import { credentialAuthorityRoutes } from './modules/credentials/presentation/credential-authority-routes.js';
import { ecacRadarRoutes } from './modules/ecac/presentation/ecac-radar-routes.js';

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
          name: 'Acesso',
          description: 'Autenticação, escritórios, vínculos e permissões.',
        },
        {
          name: 'Control - Empresas',
          description: 'Cadastro automático de empresas do plano Control (F52).',
        },
        {
          name: 'Control - Credenciais',
          description: 'Cofre de certificados digitais e credenciais do plano Control (F04).',
        },
        {
          name: 'Control - Radar e-CAC',
          description: 'Consultas multi-CNPJ assíncronas e idempotentes do plano Control (F03).',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  if (env.ENABLE_SWAGGER_UI) {
    const { default: swaggerUi } = await import('@fastify/swagger-ui');
    await app.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }

  registerErrorHandler(app);

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      expiresIn: env.JWT_EXPIRES_IN,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
      allowedAud: env.JWT_AUDIENCE,
    },
  });

  await app.register(rateLimit, {
    global: false,
    max: env.AUTH_RATE_LIMIT_MAX,
    timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS,
  });

  const authenticate = registerAuthentication(app, container.cradle);

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

  await accessRoutes(app, container.cradle, authenticate);
  await companyRoutes(app, container.cradle, authenticate);
  await digitalCertificateRoutes(app, container.cradle, authenticate);
  await credentialAuthorityRoutes(app, container.cradle, authenticate);
  await ecacRadarRoutes(app, container.cradle, authenticate);

  app.get('/openapi.json', async () => app.swagger());

  app.addHook('onClose', async () => {
    await container.dispose();
  });

  return app;
}
