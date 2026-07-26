import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../../shared/container.js';
import { authorize } from '../../../shared/infra/http/authentication.js';

const serproConnectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'certificateId',
    'contractorCnpj',
    'requesterCnpj',
    'status',
    'configuredById',
    'revokedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    certificateId: { type: 'string', format: 'uuid' },
    contractorCnpj: { type: 'string', pattern: '^\\d{14}$' },
    requesterCnpj: { type: 'string', pattern: '^\\d{14}$' },
    status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] },
    configuredById: { type: 'string', format: 'uuid' },
    revokedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const rotationResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetKeyVersion', 'rotated', 'skippedByConcurrency'],
  properties: {
    targetKeyVersion: { type: 'integer', minimum: 1 },
    rotated: { type: 'boolean' },
    skippedByConcurrency: { type: 'boolean' },
  },
} as const;

interface ConfigureSerproConnectionBody {
  certificateId: string;
  contractorCnpj: string;
  requesterCnpj: string;
  consumerKey: string;
  consumerSecret: string;
}

export async function serproConnectionRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.put<{ Body: ConfigureSerproConnectionBody }>(
    '/v1/control/ecac/serpro-connection',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Configurar credenciais cifradas do Integra Contador',
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'certificateId',
            'contractorCnpj',
            'requesterCnpj',
            'consumerKey',
            'consumerSecret',
          ],
          properties: {
            certificateId: { type: 'string', format: 'uuid' },
            contractorCnpj: { type: 'string', minLength: 14, maxLength: 18 },
            requesterCnpj: { type: 'string', minLength: 14, maxLength: 18 },
            consumerKey: { type: 'string', minLength: 8, maxLength: 256 },
            consumerSecret: { type: 'string', minLength: 8, maxLength: 512 },
          },
        },
        response: { 200: serproConnectionSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.configureSerproConnectionUseCase.execute({
        tenantId: context.tenantId,
        actorId: context.userId,
        ...request.body,
      });
    },
  );

  app.get(
    '/v1/control/ecac/serpro-connection',
    {
      preHandler: [authenticate, authorize('credentials:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Consultar metadados da conexão Integra Contador',
        response: { 200: serproConnectionSchema },
      },
    },
    async (request) =>
      cradle.getSerproConnectionUseCase.execute(
        request.authContext!.tenantId,
      ),
  );

  app.post(
    '/v1/control/ecac/serpro-connection/rotate-key',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Recifrar credenciais do Integra Contador com a chave ativa',
        response: { 200: rotationResultSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.rotateSerproConnectionKeyUseCase.execute({
        tenantId: context.tenantId,
        actorId: context.userId,
      });
    },
  );
}
