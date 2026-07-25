import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Cradle } from '../../container.js';
import {
  ForbiddenError,
  UnauthorizedError,
} from '../../domain/app-error.js';
import type { Permission } from '../../../modules/access/domain/permissions.js';
import { hasPermission } from '../../../modules/access/domain/permissions.js';

export function registerAuthentication(
  app: FastifyInstance,
  cradle: Cradle,
): preHandlerHookHandler {
  app.decorateRequest('authContext', null);

  return async function authenticate(request: FastifyRequest): Promise<void> {
    try {
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError('Token ausente, inválido ou expirado.');
    }

    const context = await cradle.accessRepository.findAuthContext(
      request.user.sub,
      request.user.membershipId,
      request.user.tenantId,
    );

    if (!context) {
      throw new UnauthorizedError('Este acesso não está mais ativo.', 'ACCESS_REVOKED');
    }

    request.authContext = context;
  };
}

export function authorize(permission: Permission): preHandlerHookHandler {
  return async function authorizationHook(request: FastifyRequest): Promise<void> {
    const context = request.authContext;

    if (!context) {
      throw new UnauthorizedError();
    }

    if (!hasPermission(context.role, permission)) {
      throw new ForbiddenError();
    }
  };
}
