import '@fastify/jwt';
import 'fastify';
import type { AuthContext, MembershipRole } from '../modules/access/domain/access.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      membershipId: string;
      tenantId: string;
      role: MembershipRole;
      securityVersion: number;
    };
    user: {
      sub: string;
      membershipId: string;
      tenantId: string;
      role: MembershipRole;
      securityVersion: number;
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}
