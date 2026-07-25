import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../../../shared/container.js';
import { authorize } from '../../../../shared/infra/http/authentication.js';

const companySchema = {
  type: 'object',
  required: [
    'id',
    'tenantId',
    'cnpj',
    'legalName',
    'registrationStatus',
    'dataSource',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    cnpj: { type: 'string', pattern: '^\\d{14}$' },
    legalName: { type: 'string' },
    tradeName: { type: ['string', 'null'] },
    registrationStatus: {
      type: 'string',
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED', 'UNKNOWN'],
    },
    openingDate: { type: ['string', 'null'], format: 'date-time' },
    primaryCnae: { type: ['string', 'null'] },
    primaryCnaeDescription: { type: ['string', 'null'] },
    municipality: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] },
    dataSource: { type: 'string', enum: ['BRASIL_API', 'MANUAL'] },
    registryUpdatedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

interface RegisterCompanyBody {
  cnpj: string;
}

interface CompanyParams {
  companyId: string;
}

export async function companyRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.post<{ Body: RegisterCompanyBody }>(
    '/v1/control/companies',
    {
      preHandler: [authenticate, authorize('companies:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Empresas'],
        summary: 'Cadastrar empresa automaticamente por CNPJ',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['cnpj'],
          properties: {
            cnpj: { type: 'string', minLength: 14, maxLength: 18 },
          },
        },
        response: {
          201: companySchema,
        },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      const company = await cradle.registerCompanyUseCase.execute({
        ...request.body,
        tenantId: context.tenantId,
        actorId: context.userId,
      });

      return reply.status(201).send(company);
    },
  );

  app.get<{ Params: CompanyParams }>(
    '/v1/control/companies/:companyId',
    {
      preHandler: [authenticate, authorize('companies:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Empresas'],
        summary: 'Consultar empresa cadastrada',
        params: {
          type: 'object',
          required: ['companyId'],
          properties: {
            companyId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: companySchema,
        },
      },
    },
    async (request) =>
      cradle.getCompanyUseCase.execute(request.authContext!.tenantId, request.params.companyId),
  );
}
