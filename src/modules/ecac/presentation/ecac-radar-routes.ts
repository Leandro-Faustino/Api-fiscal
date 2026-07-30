import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../../shared/container.js';
import { authorize } from '../../../shared/infra/http/authentication.js';
import type {
  EcacAlertStatus,
  EcacFindingSeverity,
  EcacQueryType,
  EcacSyncBatchStatus,
} from '../domain/ecac-radar.js';

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'companyId',
    'jobId',
    'code',
    'category',
    'title',
    'description',
    'severity',
    'sourceReference',
    'observedAt',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    companyId: { type: 'string', format: 'uuid' },
    jobId: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    category: { type: 'string' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
    sourceReference: { type: ['string', 'null'] },
    observedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const alertSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'companyId',
    'latestJobId',
    'queryType',
    'findingKey',
    'code',
    'category',
    'title',
    'description',
    'severity',
    'status',
    'lastChangeType',
    'firstObservedAt',
    'lastObservedAt',
    'acknowledgedAt',
    'acknowledgedById',
    'resolvedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    companyId: { type: 'string', format: 'uuid' },
    latestJobId: { type: 'string', format: 'uuid' },
    queryType: { type: 'string', enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'] },
    findingKey: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    code: { type: 'string' },
    category: { type: 'string' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
    status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] },
    lastChangeType: {
      type: 'string',
      enum: ['NEW', 'CHANGED', 'REOPENED', 'RESOLVED'],
    },
    firstObservedAt: { type: 'string', format: 'date-time' },
    lastObservedAt: { type: 'string', format: 'date-time' },
    acknowledgedAt: { type: ['string', 'null'], format: 'date-time' },
    acknowledgedById: { type: ['string', 'null'], format: 'uuid' },
    resolvedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const jobSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'batchId',
    'companyId',
    'companyCnpj',
    'powerOfAttorneyId',
    'certificateId',
    'queryType',
    'status',
    'provider',
    'protocol',
    'attemptCount',
    'maxAttempts',
    'nextAttemptAt',
    'startedAt',
    'completedAt',
    'errorCode',
    'errorMessage',
    'findings',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    batchId: { type: 'string', format: 'uuid' },
    companyId: { type: 'string', format: 'uuid' },
    companyCnpj: { type: 'string', pattern: '^\\d{14}$' },
    powerOfAttorneyId: { type: 'string', format: 'uuid' },
    certificateId: { type: 'string', format: 'uuid' },
    queryType: { type: 'string', enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'] },
    status: {
      type: 'string',
      enum: ['QUEUED', 'PROCESSING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED'],
    },
    provider: { type: ['string', 'null'] },
    protocol: { type: ['string', 'null'] },
    attemptCount: { type: 'integer', minimum: 0 },
    maxAttempts: { type: 'integer', minimum: 1 },
    nextAttemptAt: { type: 'string', format: 'date-time' },
    startedAt: { type: ['string', 'null'], format: 'date-time' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    errorCode: { type: ['string', 'null'] },
    errorMessage: { type: ['string', 'null'] },
    findings: { type: 'array', items: findingSchema },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const batchSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'requestKey',
    'queryType',
    'status',
    'requestedById',
    'totalJobs',
    'succeededJobs',
    'failedJobs',
    'jobs',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    requestKey: { type: 'string' },
    queryType: { type: 'string', enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'] },
    status: {
      type: 'string',
      enum: ['QUEUED', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED'],
    },
    requestedById: { type: 'string', format: 'uuid' },
    totalJobs: { type: 'integer', minimum: 1 },
    succeededJobs: { type: 'integer', minimum: 0 },
    failedJobs: { type: 'integer', minimum: 0 },
    jobs: { type: 'array', items: jobSchema },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

interface RequestSyncBody {
  requestKey: string;
  queryType: EcacQueryType;
  maxAttempts?: number;
  targets: Array<{
    companyId: string;
    powerOfAttorneyId: string;
  }>;
}

interface BatchParams {
  batchId: string;
}

interface ListBatchQuery {
  status?: EcacSyncBatchStatus;
  companyId?: string;
}

interface ProcessBody {
  limit?: number;
}

interface FindingQuery {
  companyId?: string;
  severity?: EcacFindingSeverity;
}

interface AlertQuery {
  companyId?: string;
  queryType?: EcacQueryType;
  severity?: EcacFindingSeverity;
  status?: EcacAlertStatus;
}

interface AlertParams {
  alertId: string;
}

export async function ecacRadarRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.post<{ Body: RequestSyncBody }>(
    '/v1/control/ecac/sync-batches',
    {
      preHandler: [authenticate, authorize('ecac:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Solicitar consulta e-CAC idempotente para até 100 CNPJs',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['requestKey', 'queryType', 'targets'],
          properties: {
            requestKey: { type: 'string', minLength: 8, maxLength: 128 },
            queryType: {
              type: 'string',
              enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'],
            },
            maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
            targets: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['companyId', 'powerOfAttorneyId'],
                properties: {
                  companyId: { type: 'string', format: 'uuid' },
                  powerOfAttorneyId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        response: { 202: batchSchema },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      const batch = await cradle.requestEcacSyncUseCase.execute({
        tenantId: context.tenantId,
        actorId: context.userId,
        ...request.body,
      });
      return reply.status(202).send(batch);
    },
  );

  app.get<{ Querystring: ListBatchQuery }>(
    '/v1/control/ecac/sync-batches',
    {
      preHandler: [authenticate, authorize('ecac:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Listar lotes do Radar e-CAC',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              type: 'string',
              enum: ['QUEUED', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED'],
            },
            companyId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: { type: 'array', items: batchSchema } },
      },
    },
    async (request) =>
      cradle.listEcacSyncBatchesUseCase.execute(
        request.authContext!.tenantId,
        request.query.status,
        request.query.companyId,
      ),
  );

  app.get<{ Params: BatchParams }>(
    '/v1/control/ecac/sync-batches/:batchId',
    {
      preHandler: [authenticate, authorize('ecac:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Consultar lote e seus jobs sem cruzar escritórios',
        params: {
          type: 'object',
          required: ['batchId'],
          properties: { batchId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: batchSchema },
      },
    },
    async (request) =>
      cradle.getEcacSyncBatchUseCase.execute(
        request.authContext!.tenantId,
        request.params.batchId,
      ),
  );

  app.post<{ Body: ProcessBody }>(
    '/v1/control/ecac/jobs/process',
    {
      preHandler: [authenticate, authorize('ecac:execute')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Processar jobs vencidos do escritório em lote limitado',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'claimed',
              'succeeded',
              'deferred',
              'retryScheduled',
              'failed',
              'leaseLost',
            ],
            properties: {
              claimed: { type: 'integer', minimum: 0 },
              succeeded: { type: 'integer', minimum: 0 },
              deferred: { type: 'integer', minimum: 0 },
              retryScheduled: { type: 'integer', minimum: 0 },
              failed: { type: 'integer', minimum: 0 },
              leaseLost: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
    async (request) =>
      cradle.processEcacJobsUseCase.execute(
        request.authContext!.tenantId,
        request.body.limit ?? 10,
      ),
  );

  app.get<{ Querystring: FindingQuery }>(
    '/v1/control/ecac/findings',
    {
      preHandler: [authenticate, authorize('ecac:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Listar achados normalizados do Radar e-CAC',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            companyId: { type: 'string', format: 'uuid' },
            severity: {
              type: 'string',
              enum: ['INFO', 'WARNING', 'CRITICAL'],
            },
          },
        },
        response: { 200: { type: 'array', items: findingSchema } },
      },
    },
    async (request) =>
      cradle.listEcacFindingsUseCase.execute(
        request.authContext!.tenantId,
        request.query.companyId,
        request.query.severity,
      ),
  );

  app.get<{ Querystring: AlertQuery }>(
    '/v1/control/ecac/alerts',
    {
      preHandler: [authenticate, authorize('ecac:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Listar alertas derivados de mudanças entre consultas',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            companyId: { type: 'string', format: 'uuid' },
            queryType: {
              type: 'string',
              enum: ['TAX_STATUS', 'DEBTS', 'MAILBOX'],
            },
            severity: {
              type: 'string',
              enum: ['INFO', 'WARNING', 'CRITICAL'],
            },
            status: {
              type: 'string',
              enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
            },
          },
        },
        response: { 200: { type: 'array', items: alertSchema } },
      },
    },
    async (request) =>
      cradle.listEcacAlertsUseCase.execute(
        request.authContext!.tenantId,
        request.query,
      ),
  );

  app.post<{ Params: AlertParams }>(
    '/v1/control/ecac/alerts/:alertId/acknowledge',
    {
      preHandler: [authenticate, authorize('ecac:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Radar e-CAC'],
        summary: 'Reconhecer um alerta e-CAC aberto',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['alertId'],
          properties: { alertId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: alertSchema },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.acknowledgeEcacAlertUseCase.execute(
        context.tenantId,
        request.params.alertId,
        context.userId,
      );
    },
  );
}
