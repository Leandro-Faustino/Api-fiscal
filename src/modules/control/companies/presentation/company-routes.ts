import type { FastifyInstance } from 'fastify';
import type { Cradle } from '../../../../shared/container.js';

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
  tenantId: string;
  cnpj: string;
}

interface CompanyParams {
  companyId: string;
}

interface TenantQuery {
  tenantId: string;
}

interface ActorHeaders {
  'x-actor-id'?: string;
}

export async function companyRoutes(app: FastifyInstance, cradle: Cradle): Promise<void> {
  app.post<{ Body: RegisterCompanyBody; Headers: ActorHeaders }>(
    '/v1/control/companies',
    {
      schema: {
        tags: ['Control - Empresas'],
        summary: 'Cadastrar empresa automaticamente por CNPJ',
        headers: {
          type: 'object',
          properties: {
            'x-actor-id': { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tenantId', 'cnpj'],
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            cnpj: { type: 'string', minLength: 14, maxLength: 18 },
          },
        },
        response: {
          201: companySchema,
        },
      },
    },
    async (request, reply) => {
      const company = await cradle.registerCompanyUseCase.execute({
        ...request.body,
        actorId: request.headers['x-actor-id'] ?? null,
      });

      return reply.status(201).send(company);
    },
  );

  app.get<{ Params: CompanyParams; Querystring: TenantQuery }>(
    '/v1/control/companies/:companyId',
    {
      schema: {
        tags: ['Control - Empresas'],
        summary: 'Consultar empresa cadastrada',
        params: {
          type: 'object',
          required: ['companyId'],
          properties: {
            companyId: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['tenantId'],
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: companySchema,
        },
      },
    },
    async (request) =>
      cradle.getCompanyUseCase.execute(request.query.tenantId, request.params.companyId),
  );
}
