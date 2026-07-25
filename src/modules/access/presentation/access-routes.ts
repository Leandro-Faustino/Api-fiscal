import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { Cradle } from '../../../shared/container.js';
import type {
  AccessSession,
  MembershipRole,
} from '../domain/access.js';
import { authorize } from '../../../shared/infra/http/authentication.js';
import type { RefreshTokenResult } from '../application/use-cases/create-refresh-session.js';

const roles = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;

const authContextSchema = {
  type: 'object',
  required: [
    'userId',
    'membershipId',
    'tenantId',
    'tenantSlug',
    'role',
    'email',
    'name',
  ],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    membershipId: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    tenantSlug: { type: 'string' },
    role: { type: 'string', enum: roles },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
  },
} as const;

const authResponseSchema = {
  type: 'object',
  required: [
    'accessToken',
    'refreshToken',
    'refreshExpiresAt',
    'tokenType',
    'expiresIn',
    'session',
  ],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    refreshExpiresAt: { type: 'string', format: 'date-time' },
    tokenType: { type: 'string', enum: ['Bearer'] },
    expiresIn: { type: 'string' },
    session: {
      ...authContextSchema,
      required: [...authContextSchema.required, 'tenantName'],
      properties: {
        ...authContextSchema.properties,
        tenantName: { type: 'string' },
      },
    },
  },
} as const;

interface RegisterBody {
  tenantName: string;
  tenantSlug: string;
  userName: string;
  email: string;
  password: string;
}

interface LoginBody {
  tenantSlug: string;
  email: string;
  password: string;
}

interface InvitationBody {
  email: string;
  role: MembershipRole;
}

interface InvitationParams {
  token: string;
}

interface AcceptInvitationBody {
  userName: string;
  password: string;
}

interface RefreshTokenBody {
  refreshToken: string;
}

async function createAuthResponse(
  reply: FastifyReply,
  session: AccessSession,
  expiresIn: string,
  refresh: RefreshTokenResult,
): Promise<{
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  tokenType: 'Bearer';
  expiresIn: string;
  session: AccessSession;
}> {
  const accessToken = await reply.jwtSign({
    sub: session.userId,
    membershipId: session.membershipId,
    tenantId: session.tenantId,
    role: session.role,
  });

  return {
    accessToken,
    refreshToken: refresh.refreshToken,
    refreshExpiresAt: refresh.refreshExpiresAt,
    tokenType: 'Bearer',
    expiresIn,
    session,
  };
}

function sessionMetadata(request: FastifyRequest): {
  ipAddress: string;
  userAgent: string | null;
} {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

function publicAuthRateLimit(cradle: Cradle): {
  rateLimit: { max: number; timeWindow: number };
} {
  return {
    rateLimit: {
      max: cradle.authRateLimitMax,
      timeWindow: cradle.authRateLimitWindowMs,
    },
  };
}

export async function accessRoutes(
  app: FastifyInstance,
  cradle: Cradle,
  authenticate: preHandlerHookHandler,
): Promise<void> {
  app.post<{ Body: RegisterBody }>(
    '/v1/auth/register',
    {
      config: publicAuthRateLimit(cradle),
      schema: {
        tags: ['Acesso'],
        summary: 'Criar escritório e usuário proprietário',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tenantName', 'tenantSlug', 'userName', 'email', 'password'],
          properties: {
            tenantName: { type: 'string', minLength: 2, maxLength: 120 },
            tenantSlug: {
              type: 'string',
              minLength: 3,
              maxLength: 60,
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            },
            userName: { type: 'string', minLength: 2, maxLength: 120 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 12, maxLength: 128 },
          },
        },
        response: { 201: authResponseSchema },
      },
    },
    async (request, reply) => {
      const session = await cradle.registerTenantUseCase.execute(request.body);
      const refresh = await cradle.createRefreshSessionUseCase.execute(
        session,
        sessionMetadata(request),
      );
      return reply
        .status(201)
        .send(await createAuthResponse(reply, session, cradle.jwtExpiresIn, refresh));
    },
  );

  app.post<{ Body: LoginBody }>(
    '/v1/auth/login',
    {
      config: publicAuthRateLimit(cradle),
      schema: {
        tags: ['Acesso'],
        summary: 'Entrar em um escritório',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tenantSlug', 'email', 'password'],
          properties: {
            tenantSlug: { type: 'string', minLength: 3, maxLength: 60 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const session = await cradle.loginUseCase.execute(request.body);
      const refresh = await cradle.createRefreshSessionUseCase.execute(
        session,
        sessionMetadata(request),
      );
      return reply.send(
        await createAuthResponse(reply, session, cradle.jwtExpiresIn, refresh),
      );
    },
  );

  app.post<{ Params: InvitationParams; Body: AcceptInvitationBody }>(
    '/v1/auth/invitations/:token/accept',
    {
      config: publicAuthRateLimit(cradle),
      schema: {
        tags: ['Acesso'],
        summary: 'Aceitar convite de acesso ao escritório',
        params: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 32, maxLength: 128 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['userName', 'password'],
          properties: {
            userName: { type: 'string', minLength: 2, maxLength: 120 },
            password: { type: 'string', minLength: 12, maxLength: 128 },
          },
        },
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const session = await cradle.acceptInvitationUseCase.execute({
        token: request.params.token,
        ...request.body,
      });
      const refresh = await cradle.createRefreshSessionUseCase.execute(
        session,
        sessionMetadata(request),
      );

      return reply.send(
        await createAuthResponse(reply, session, cradle.jwtExpiresIn, refresh),
      );
    },
  );

  app.post<{ Body: RefreshTokenBody }>(
    '/v1/auth/refresh',
    {
      config: publicAuthRateLimit(cradle),
      schema: {
        tags: ['Acesso'],
        summary: 'Renovar sessão com rotação do refresh token',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', minLength: 64, maxLength: 128 },
          },
        },
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await cradle.rotateRefreshSessionUseCase.execute(
        request.body.refreshToken,
        sessionMetadata(request),
      );

      return reply.send(
        await createAuthResponse(reply, result.session, cradle.jwtExpiresIn, result),
      );
    },
  );

  app.post<{ Body: RefreshTokenBody }>(
    '/v1/auth/logout',
    {
      config: publicAuthRateLimit(cradle),
      schema: {
        tags: ['Acesso'],
        summary: 'Encerrar a família da sessão',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', minLength: 64, maxLength: 128 },
          },
        },
        response: {
          204: { type: 'null' },
        },
      },
    },
    async (request, reply) => {
      await cradle.revokeRefreshSessionUseCase.execute(request.body.refreshToken);
      return reply.status(204).send();
    },
  );

  app.get(
    '/v1/auth/me',
    {
      preHandler: [authenticate],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Acesso'],
        summary: 'Consultar o contexto autenticado',
        response: { 200: authContextSchema },
      },
    },
    async (request) => request.authContext,
  );

  app.post<{ Body: InvitationBody }>(
    '/v1/access/invitations',
    {
      preHandler: [authenticate, authorize('members:invite')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Acesso'],
        summary: 'Convidar usuário para o escritório',
        description:
          'O token é retornado somente nesta resposta. A entrega por e-mail será adicionada em uma etapa posterior.',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'role'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: roles },
          },
        },
        response: {
          201: {
            type: 'object',
            required: ['id', 'email', 'role', 'expiresAt', 'token'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              role: { type: 'string', enum: roles },
              expiresAt: { type: 'string', format: 'date-time' },
              token: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const context = request.authContext!;
      const result = await cradle.createInvitationUseCase.execute({
        tenantId: context.tenantId,
        actorId: context.userId,
        actorRole: context.role,
        ...request.body,
      });

      return reply.status(201).send({
        id: result.invitation.id,
        email: result.invitation.email,
        role: result.invitation.role,
        expiresAt: result.invitation.expiresAt,
        token: result.token,
      });
    },
  );

  app.get(
    '/v1/access/members',
    {
      preHandler: [authenticate, authorize('members:read')],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Acesso'],
        summary: 'Listar usuários vinculados ao escritório',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'membershipId',
                'userId',
                'name',
                'email',
                'role',
                'status',
                'createdAt',
              ],
              properties: {
                membershipId: { type: 'string', format: 'uuid' },
                userId: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                role: { type: 'string', enum: roles },
                status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    async (request) => cradle.listMembersUseCase.execute(request.authContext!.tenantId),
  );
}
