import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../../shared/container.js';
import { authorize } from '../../../shared/infra/http/authentication.js';

const certificateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'label',
    'kind',
    'status',
    'lifecycle',
    'fingerprintSha256',
    'serialNumber',
    'subjectCommonName',
    'issuerCommonName',
    'validFrom',
    'validUntil',
    'companyIds',
    'uploadedById',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    label: { type: 'string' },
    kind: { type: 'string', enum: ['A1'] },
    status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] },
    lifecycle: {
      type: 'string',
      enum: ['ACTIVE', 'REVOKED', 'EXPIRED', 'NOT_YET_VALID'],
    },
    fingerprintSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    serialNumber: { type: 'string' },
    subjectCommonName: { type: 'string' },
    issuerCommonName: { type: 'string' },
    validFrom: { type: 'string', format: 'date-time' },
    validUntil: { type: 'string', format: 'date-time' },
    companyIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    },
    uploadedById: { type: 'string', format: 'uuid' },
    revokedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

interface UploadCertificateBody {
  label: string;
  pfxBase64: string;
  password: string;
  companyIds: string[];
}

interface CertificateParams {
  certificateId: string;
}

interface RotateCredentialKeysBody {
  limit?: number;
}

export async function digitalCertificateRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.post<{ Body: UploadCertificateBody }>(
    '/v1/control/credentials/certificates/a1',
    {
      bodyLimit: 3 * 1024 * 1024,
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Validar, cifrar e cadastrar certificado digital A1',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'pfxBase64', 'password', 'companyIds'],
          properties: {
            label: { type: 'string', minLength: 2, maxLength: 120 },
            pfxBase64: { type: 'string', minLength: 4, maxLength: 2_800_000 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
            companyIds: {
              type: 'array',
              minItems: 1,
              maxItems: 300,
              uniqueItems: true,
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        response: {
          201: certificateSchema,
        },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      const certificate = await cradle.uploadA1CertificateUseCase.execute({
        ...request.body,
        tenantId: context.tenantId,
        actorId: context.userId,
      });
      return reply.status(201).send(certificate);
    },
  );

  app.get(
    '/v1/control/credentials/certificates',
    {
      preHandler: [authenticate, authorize('credentials:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Listar metadados dos certificados do escritório',
        response: {
          200: {
            type: 'array',
            items: certificateSchema,
          },
        },
      },
    },
    async (request) =>
      cradle.listDigitalCertificatesUseCase.execute(request.authContext!.tenantId),
  );

  app.get<{ Params: CertificateParams }>(
    '/v1/control/credentials/certificates/:certificateId',
    {
      preHandler: [authenticate, authorize('credentials:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Consultar metadados de um certificado',
        params: {
          type: 'object',
          required: ['certificateId'],
          properties: {
            certificateId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: certificateSchema,
        },
      },
    },
    async (request) =>
      cradle.getDigitalCertificateUseCase.execute(
        request.authContext!.tenantId,
        request.params.certificateId,
      ),
  );

  app.post<{ Params: CertificateParams }>(
    '/v1/control/credentials/certificates/:certificateId/revoke',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Revogar uso de um certificado no cofre',
        params: {
          type: 'object',
          required: ['certificateId'],
          properties: {
            certificateId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: certificateSchema,
        },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.revokeDigitalCertificateUseCase.execute(
        context.tenantId,
        request.params.certificateId,
        context.userId,
      );
    },
  );

  app.post<{ Body: RotateCredentialKeysBody }>(
    '/v1/control/credentials/certificates/rotate-key',
    {
      preHandler: [authenticate, authorize('credentials:write')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Control - Credenciais'],
        summary: 'Recifrar lote de certificados com a chave ativa do cofre',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'targetKeyVersion',
              'scanned',
              'rotated',
              'skippedByConcurrency',
              'hasMore',
            ],
            properties: {
              targetKeyVersion: { type: 'integer', minimum: 1 },
              scanned: { type: 'integer', minimum: 0 },
              rotated: { type: 'integer', minimum: 0 },
              skippedByConcurrency: { type: 'integer', minimum: 0 },
              hasMore: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request) => {
      const context = request.authContext!;
      return cradle.rotateCredentialKeysUseCase.execute({
        tenantId: context.tenantId,
        actorId: context.userId,
        ...(request.body.limit === undefined ? {} : { limit: request.body.limit }),
      });
    },
  );
}
