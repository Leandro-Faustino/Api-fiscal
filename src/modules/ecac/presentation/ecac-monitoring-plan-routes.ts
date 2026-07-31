import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../../shared/container.js';
import { authorize } from '../../../shared/infra/http/authentication.js';
import {
  MAXIMUM_MONITORING_INTERVAL_MINUTES,
  MINIMUM_MONITORING_INTERVAL_MINUTES,
  type EcacMonitoringPlanStatus,
} from '../domain/ecac-monitoring-plan.js';
import type { EcacQueryType } from '../domain/ecac-radar.js';

const monitoringPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'companyId',
    'powerOfAttorneyId',
    'queryType',
    'status',
    'intervalMinutes',
    'maxAttempts',
    'nextRunAt',
    'lastRunAt',
    'lastBatchId',
    'lastFailureAt',
    'lastFailureCode',
    'consecutiveFailures',
    'triggeredRuns',
    'createdById',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    companyId: { type: 'string', format: 'uuid' },
    powerOfAttorneyId: { type: 'string', format: 'uuid' },
    queryType: { type: 'string', enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'] },
    status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
    intervalMinutes: { type: 'integer' },
    maxAttempts: { type: 'integer' },
    nextRunAt: { type: 'string', format: 'date-time' },
    lastRunAt: { type: ['string', 'null'], format: 'date-time' },
    lastBatchId: { type: ['string', 'null'], format: 'uuid' },
    lastFailureAt: { type: ['string', 'null'], format: 'date-time' },
    lastFailureCode: { type: ['string', 'null'] },
    consecutiveFailures: { type: 'integer', minimum: 0 },
    triggeredRuns: { type: 'integer', minimum: 0 },
    createdById: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

interface UpsertPlanBody {
  companyId: string;
  powerOfAttorneyId: string;
  queryType: EcacQueryType;
  intervalMinutes: number;
  maxAttempts?: number;
  startAt?: string;
}

interface ListPlanQuery {
  companyId?: string;
  queryType?: EcacQueryType;
  status?: EcacMonitoringPlanStatus;
}

interface PlanParams {
  planId: string;
}

export async function ecacMonitoringPlanRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.put<{ Body: UpsertPlanBody }>(
    '/v1/control/ecac/monitoring-plans',
    {
      preHandler: [authenticate, authorize('ecac:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary:
          'Configurar o monitoramento recorrente de uma empresa e tipo de consulta',
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'companyId',
            'powerOfAttorneyId',
            'queryType',
            'intervalMinutes',
          ],
          properties: {
            companyId: { type: 'string', format: 'uuid' },
            powerOfAttorneyId: { type: 'string', format: 'uuid' },
            queryType: {
              type: 'string',
              enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'],
            },
            intervalMinutes: {
              type: 'integer',
              minimum: MINIMUM_MONITORING_INTERVAL_MINUTES,
              maximum: MAXIMUM_MONITORING_INTERVAL_MINUTES,
            },
            maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
            startAt: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: monitoringPlanSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.upsertEcacMonitoringPlanUseCase.execute({
        tenantId: context.tenantId,
        actorId: context.userId,
        ...request.body,
      });
    },
  );

  app.get<{ Querystring: ListPlanQuery }>(
    '/v1/control/ecac/monitoring-plans',
    {
      preHandler: [authenticate, authorize('ecac:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Listar planos de monitoramento recorrente do escritório',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            companyId: { type: 'string', format: 'uuid' },
            queryType: {
              type: 'string',
              enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'],
            },
            status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
          },
        },
        response: { 200: { type: 'array', items: monitoringPlanSchema } },
      },
    },
    async (request) =>
      cradle.listEcacMonitoringPlansUseCase.execute(
        request.authContext!.tenantId,
        request.query,
      ),
  );

  app.get<{ Params: PlanParams }>(
    '/v1/control/ecac/monitoring-plans/:planId',
    {
      preHandler: [authenticate, authorize('ecac:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Consultar um plano de monitoramento recorrente',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: monitoringPlanSchema },
      },
    },
    async (request) =>
      cradle.getEcacMonitoringPlanUseCase.execute(
        request.authContext!.tenantId,
        request.params.planId,
      ),
  );

  app.post<{ Params: PlanParams }>(
    '/v1/control/ecac/monitoring-plans/:planId/pause',
    {
      preHandler: [authenticate, authorize('ecac:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Pausar um plano de monitoramento recorrente',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: monitoringPlanSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.pauseEcacMonitoringPlanUseCase.execute(
        context.tenantId,
        request.params.planId,
        context.userId,
      );
    },
  );

  app.post<{ Params: PlanParams }>(
    '/v1/control/ecac/monitoring-plans/:planId/resume',
    {
      preHandler: [authenticate, authorize('ecac:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Retomar um plano de monitoramento pausado',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: monitoringPlanSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.resumeEcacMonitoringPlanUseCase.execute(
        context.tenantId,
        request.params.planId,
        context.userId,
      );
    },
  );

  app.delete<{ Params: PlanParams }>(
    '/v1/control/ecac/monitoring-plans/:planId',
    {
      preHandler: [authenticate, authorize('ecac:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Remover um plano de monitoramento recorrente',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      await cradle.deleteEcacMonitoringPlanUseCase.execute(
        context.tenantId,
        request.params.planId,
        context.userId,
      );
      return reply.status(204).send();
    },
  );
}
