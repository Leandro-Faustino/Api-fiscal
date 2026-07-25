import { type Prisma, type PrismaClient } from '@prisma/client';
import type { AccessSession } from '../../domain/access.js';
import type {
  CreateRefreshSessionInput,
  RefreshSessionRepository,
  RotateRefreshSessionInput,
  RotateRefreshSessionResult,
} from '../../application/ports/refresh-session-repository.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

const sessionMembershipSelect = {
  id: true,
  role: true,
  status: true,
  tenant: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      securityVersion: true,
      mfaEnabledAt: true,
    },
  },
} satisfies Prisma.MembershipSelect;

type SessionMembership = Prisma.MembershipGetPayload<{
  select: typeof sessionMembershipSelect;
}>;

function toAccessSession(membership: SessionMembership): AccessSession {
  return {
    userId: membership.user.id,
    membershipId: membership.id,
    tenantId: membership.tenant.id,
    tenantName: membership.tenant.name,
    tenantSlug: membership.tenant.slug,
    role: membership.role,
    email: membership.user.email,
    name: membership.user.name,
    securityVersion: membership.user.securityVersion,
    mfaEnabled: membership.user.mfaEnabledAt !== null,
  };
}

export class PrismaRefreshSessionRepository implements RefreshSessionRepository {
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async create(input: CreateRefreshSessionInput): Promise<void> {
    await this.prisma.refreshSession.create({
      data: input,
    });
  }

  public async rotate(
    input: RotateRefreshSessionInput,
  ): Promise<RotateRefreshSessionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.refreshSession.findUnique({
        where: { tokenHash: input.currentTokenHash },
        include: {
          membership: {
            select: sessionMembershipSelect,
          },
        },
      });

      if (!current) {
        return { status: 'NOT_FOUND' };
      }

      const now = new Date();

      if (current.usedAt) {
        await this.revokeFamily(transaction, current.familyId, now);
        await this.auditReuse(transaction, current.membership, current.id);
        return { status: 'REUSED' };
      }

      if (current.revokedAt) {
        return { status: 'REVOKED' };
      }

      if (current.expiresAt.getTime() <= now.getTime()) {
        return { status: 'EXPIRED' };
      }

      if (
        current.membership.status !== 'ACTIVE' ||
        current.membership.user.status !== 'ACTIVE'
      ) {
        await this.revokeFamily(transaction, current.familyId, now);
        return { status: 'BLOCKED' };
      }

      if (
        (current.membership.role === 'OWNER' ||
          current.membership.role === 'ADMIN') &&
        current.membership.user.mfaEnabledAt === null
      ) {
        await this.revokeFamily(transaction, current.familyId, now);
        return { status: 'MFA_REQUIRED' };
      }

      const consumed = await transaction.refreshSession.updateMany({
        where: {
          id: current.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consumed.count !== 1) {
        await this.revokeFamily(transaction, current.familyId, now);
        await this.auditReuse(transaction, current.membership, current.id);
        return { status: 'REUSED' };
      }

      const replacement = await transaction.refreshSession.create({
        data: {
          familyId: current.familyId,
          membershipId: current.membershipId,
          tokenHash: input.newTokenHash,
          expiresAt: input.newExpiresAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });

      await transaction.auditLog.create({
        data: {
          tenantId: current.membership.tenant.id,
          actorId: current.membership.user.id,
          action: 'auth.session.rotated',
          entityType: 'refresh_session',
          entityId: replacement.id,
          metadata: { familyId: current.familyId },
        },
      });

      return {
        status: 'ROTATED',
        session: toAccessSession(current.membership),
      };
    });
  }

  public async revoke(tokenHash: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.refreshSession.findUnique({
        where: { tokenHash },
        include: {
          membership: {
            select: sessionMembershipSelect,
          },
        },
      });

      if (!session || session.revokedAt) {
        return;
      }

      const now = new Date();
      await this.revokeFamily(transaction, session.familyId, now);
      await transaction.auditLog.create({
        data: {
          tenantId: session.membership.tenant.id,
          actorId: session.membership.user.id,
          action: 'auth.session.revoked',
          entityType: 'refresh_session',
          entityId: session.id,
          metadata: { familyId: session.familyId },
        },
      });
    });
  }

  private async revokeFamily(
    transaction: Prisma.TransactionClient,
    familyId: string,
    revokedAt: Date,
  ): Promise<void> {
    await transaction.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt },
    });
  }

  private async auditReuse(
    transaction: Prisma.TransactionClient,
    membership: SessionMembership,
    sessionId: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        tenantId: membership.tenant.id,
        actorId: membership.user.id,
        action: 'auth.refresh.reuse_detected',
        entityType: 'refresh_session',
        entityId: sessionId,
      },
    });
  }
}
