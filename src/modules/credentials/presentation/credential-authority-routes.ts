import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../../shared/container.js';
import { authorize } from '../../../shared/infra/http/authentication.js';

const responsibleSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'companyId',
    'membershipId',
    'role',
    'status',
    'assignedById',
    'memberName',
    'memberEmail',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    companyId: { type: 'string', format: 'uuid' },
    membershipId: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: ['PRIMARY', 'SUPPORT'] },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    assignedById: { type: 'string', format: 'uuid' },
    memberName: { type: 'string' },
    memberEmail: { type: 'string', format: 'email' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const powerOfAttorneySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'companyId',
    'responsibleId',
    'certificateId',
    'label',
    'externalReference',
    'services',
    'status',
    'lifecycle',
    'validFrom',
    'validUntil',
    'createdById',
    'revokedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    companyId: { type: 'string', format: 'uuid' },
    responsibleId: { type: 'string', format: 'uuid' },
    certificateId: { type: ['string', 'null'], format: 'uuid' },
    label: { type: 'string' },
    externalReference: { type: ['string', 'null'] },
    services: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] },
    lifecycle: {
      type: 'string',
      enum: ['ACTIVE', 'REVOKED', 'EXPIRED', 'NOT_YET_VALID'],
    },
    validFrom: { type: 'string', format: 'date-time' },
    validUntil: { type: 'string', format: 'date-time' },
    createdById: { type: 'string', format: 'uuid' },
    revokedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const alertSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'sourceType',
    'sourceId',
    'sourceLabel',
    'kind',
    'status',
    'thresholdDays',
    'dueAt',
    'acknowledgedAt',
    'acknowledgedById',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    sourceType: {
      type: 'string',
      enum: ['CERTIFICATE', 'POWER_OF_ATTORNEY'],
    },
    sourceId: { type: 'string', format: 'uuid' },
    sourceLabel: { type: 'string' },
    kind: { type: 'string', enum: ['EXPIRING', 'EXPIRED'] },
    status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED'] },
    thresholdDays: { type: 'integer', minimum: 0 },
    dueAt: { type: 'string', format: 'date-time' },
    acknowledgedAt: { type: ['string', 'null'], format: 'date-time' },
    acknowledgedById: { type: ['string', 'null'], format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

interface CompanyParams {
  companyId: string;
}

interface ResponsibleParams extends CompanyParams {
  responsibleId: string;
}

interface AssignResponsibleBody {
  membershipId: string;
  role: 'PRIMARY' | 'SUPPORT';
}

interface CreatePowerOfAttorneyBody {
  companyId: string;
  responsibleId: string;
  certificateId?: string | null;
  label: string;
  externalReference?: string | null;
  services: string[];
  validFrom: string;
  validUntil: string;
}

interface PowerOfAttorneyParams {
  powerOfAttorneyId: string;
}

interface PowerOfAttorneyQuery {
  companyId?: string;
}

interface AlertParams {
  alertId: string;
}

interface AlertQuery {
  status?: 'OPEN' | 'ACKNOWLEDGED';
}

export async function credentialAuthorityRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.post<{ Params: CompanyParams; Body: AssignResponsibleBody }>(
    '/v1/control/credentials/companies/:companyId/responsibles',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Atribuir responsável contábil a uma empresa',
        params: {
          type: 'object',
          required: ['companyId'],
          properties: { companyId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['membershipId', 'role'],
          properties: {
            membershipId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['PRIMARY', 'SUPPORT'] },
          },
        },
        response: { 201: responsibleSchema },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      const responsible = await cradle.assignCompanyResponsibleUseCase.execute({
        tenantId: context.tenantId,
        companyId: request.params.companyId,
        membershipId: request.body.membershipId,
        role: request.body.role,
        actorId: context.userId,
      });
      return reply.status(201).send(responsible);
    },
  );

  app.get<{ Params: CompanyParams }>(
    '/v1/control/credentials/companies/:companyId/responsibles',
    {
      preHandler: [authenticate, authorize('credentials:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Listar responsáveis contábeis de uma empresa',
        params: {
          type: 'object',
          required: ['companyId'],
          properties: { companyId: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: { type: 'array', items: responsibleSchema },
        },
      },
    },
    async (request) =>
      cradle.listCompanyResponsiblesUseCase.execute(
        request.authContext!.tenantId,
        request.params.companyId,
      ),
  );

  app.post<{ Params: ResponsibleParams }>(
    '/v1/control/credentials/companies/:companyId/responsibles/:responsibleId/deactivate',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Desativar responsável sem apagar o histórico',
        params: {
          type: 'object',
          required: ['companyId', 'responsibleId'],
          properties: {
            companyId: { type: 'string', format: 'uuid' },
            responsibleId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: responsibleSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.deactivateCompanyResponsibleUseCase.execute(
        context.tenantId,
        request.params.companyId,
        request.params.responsibleId,
        context.userId,
      );
    },
  );

  app.post<{ Body: CreatePowerOfAttorneyBody }>(
    '/v1/control/credentials/powers-of-attorney',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Cadastrar procuração e sua vigência',
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'companyId',
            'responsibleId',
            'label',
            'services',
            'validFrom',
            'validUntil',
          ],
          properties: {
            companyId: { type: 'string', format: 'uuid' },
            responsibleId: { type: 'string', format: 'uuid' },
            certificateId: { type: ['string', 'null'], format: 'uuid' },
            label: { type: 'string', minLength: 2, maxLength: 120 },
            externalReference: { type: ['string', 'null'], maxLength: 120 },
            services: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              uniqueItems: true,
              items: {
                type: 'string',
                minLength: 2,
                maxLength: 80,
                pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]+$',
              },
            },
            validFrom: { type: 'string', format: 'date' },
            validUntil: { type: 'string', format: 'date' },
          },
        },
        response: { 201: powerOfAttorneySchema },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      const powerOfAttorney = await cradle.createPowerOfAttorneyUseCase.execute({
        ...request.body,
        validFrom: new Date(request.body.validFrom),
        validUntil: new Date(request.body.validUntil),
        tenantId: context.tenantId,
        actorId: context.userId,
      });
      return reply.status(201).send(powerOfAttorney);
    },
  );

  app.get<{ Querystring: PowerOfAttorneyQuery }>(
    '/v1/control/credentials/powers-of-attorney',
    {
      preHandler: [authenticate, authorize('credentials:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Listar procurações e situação de vigência',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { companyId: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: { type: 'array', items: powerOfAttorneySchema },
        },
      },
    },
    async (request) =>
      cradle.listPowersOfAttorneyUseCase.execute(
        request.authContext!.tenantId,
        request.query.companyId,
      ),
  );

  app.post<{ Params: PowerOfAttorneyParams }>(
    '/v1/control/credentials/powers-of-attorney/:powerOfAttorneyId/revoke',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Revogar procuração sem apagar o histórico',
        params: {
          type: 'object',
          required: ['powerOfAttorneyId'],
          properties: {
            powerOfAttorneyId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: powerOfAttorneySchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.revokePowerOfAttorneyUseCase.execute(
        context.tenantId,
        request.params.powerOfAttorneyId,
        context.userId,
      );
    },
  );

  app.post(
    '/v1/control/credentials/alerts/scan',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Gerar alertas deduplicados de vencimento',
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['scanned', 'created'],
            properties: {
              scanned: { type: 'integer', minimum: 0 },
              created: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.scanCredentialExpirationAlertsUseCase.execute(
        context.tenantId,
        context.userId,
      );
    },
  );

  app.get<{ Querystring: AlertQuery }>(
    '/v1/control/credentials/alerts',
    {
      preHandler: [authenticate, authorize('credentials:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Listar alertas do cofre',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED'] },
          },
        },
        response: { 200: { type: 'array', items: alertSchema } },
      },
    },
    async (request) =>
      cradle.listCredentialAlertsUseCase.execute(
        request.authContext!.tenantId,
        request.query.status,
      ),
  );

  app.post<{ Params: AlertParams }>(
    '/v1/control/credentials/alerts/:alertId/acknowledge',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Marcar alerta como reconhecido',
        params: {
          type: 'object',
          required: ['alertId'],
          properties: { alertId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: alertSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.acknowledgeCredentialAlertUseCase.execute(
        context.tenantId,
        request.params.alertId,
        context.userId,
      );
    },
  );
}
