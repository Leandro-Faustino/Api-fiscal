import { type Prisma, type PrismaClient } from '@prisma/client';
import type { AccessSession } from '../../domain/access.js';
import type {
  CompleteMfaChallengeResult,
  CreateMfaChallengeInput,
  MfaChallengeRecord,
  ResetPasswordResult,
  SecurityRepository,
} from '../../application/ports/security-repository.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

const membershipSelect = {
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
      mfaSecretEncrypted: true,
    },
  },
} satisfies Prisma.MembershipSelect;

type MembershipRecord = Prisma.MembershipGetPayload<{
  select: typeof membershipSelect;
}>;

function toSession(membership: MembershipRecord): AccessSession {
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

export class PrismaSecurityRepository implements SecurityRepository {
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async createMfaChallenge(input: CreateMfaChallengeInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.mfaChallenge.updateMany({
        where: {
          userId: input.userId,
          membershipId: input.membershipId,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await transaction.mfaChallenge.create({ data: input });
    });
  }

  public async findMfaChallenge(tokenHash: string): Promise<MfaChallengeRecord | null> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash },
      include: {
        membership: { select: membershipSelect },
      },
    });

    if (!challenge) {
      return null;
    }

    return {
      id: challenge.id,
      type: challenge.type,
      session: toSession(challenge.membership),
      secretEncrypted: challenge.secretEncrypted,
      userMfaSecretEncrypted: challenge.membership.user.mfaSecretEncrypted,
      expiresAt: challenge.expiresAt,
      consumedAt: challenge.consumedAt,
      failedAttempts: challenge.failedAttempts,
    };
  }

  public async recordFailedMfaAttempt(
    challengeId: string,
    maximumAttempts: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.mfaChallenge.update({
        where: { id: challengeId },
        data: { failedAttempts: { increment: 1 } },
        select: {
          failedAttempts: true,
          consumedAt: true,
          membership: {
            select: {
              tenantId: true,
              userId: true,
            },
          },
        },
      });

      if (!updated.consumedAt && updated.failedAttempts >= maximumAttempts) {
        await transaction.mfaChallenge.update({
          where: { id: challengeId },
          data: { consumedAt: new Date() },
        });
        await transaction.auditLog.create({
          data: {
            tenantId: updated.membership.tenantId,
            actorId: updated.membership.userId,
            action: 'auth.mfa.challenge_locked',
            entityType: 'mfa_challenge',
            entityId: challengeId,
          },
        });
      }
    });
  }

  public async completeMfaChallenge(
    challengeId: string,
    recoveryCodeHashes: string[] = [],
  ): Promise<CompleteMfaChallengeResult> {
    return this.prisma.$transaction(async (transaction) => {
      const challenge = await transaction.mfaChallenge.findUnique({
        where: { id: challengeId },
        include: {
          membership: { select: membershipSelect },
        },
      });

      if (!challenge) {
        return { status: 'NOT_FOUND' };
      }
      if (challenge.consumedAt) {
        return { status: 'CONSUMED' };
      }
      if (challenge.expiresAt.getTime() <= Date.now()) {
        return { status: 'EXPIRED' };
      }
      if (
        challenge.membership.status !== 'ACTIVE' ||
        challenge.membership.user.status !== 'ACTIVE'
      ) {
        return { status: 'BLOCKED' };
      }

      const consumed = await transaction.mfaChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        return { status: 'CONCURRENT' };
      }

      if (challenge.type === 'SETUP') {
        if (!challenge.secretEncrypted || recoveryCodeHashes.length === 0) {
          return { status: 'CONCURRENT' };
        }

        await transaction.user.update({
          where: { id: challenge.userId },
          data: {
            mfaEnabledAt: new Date(),
            mfaSecretEncrypted: challenge.secretEncrypted,
            securityVersion: { increment: 1 },
          },
        });
        await transaction.mfaRecoveryCode.deleteMany({
          where: { userId: challenge.userId },
        });
        await transaction.mfaRecoveryCode.createMany({
          data: recoveryCodeHashes.map((codeHash) => ({
            userId: challenge.userId,
            codeHash,
          })),
        });
        await transaction.refreshSession.updateMany({
          where: {
            membership: { userId: challenge.userId },
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }

      await transaction.user.update({
        where: { id: challenge.userId },
        data: { lastLoginAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: challenge.membership.tenant.id,
          actorId: challenge.userId,
          action:
            challenge.type === 'SETUP'
              ? 'auth.mfa.enabled'
              : 'auth.mfa.verified',
          entityType: 'user',
          entityId: challenge.userId,
        },
      });

      const membership = await transaction.membership.findUniqueOrThrow({
        where: { id: challenge.membershipId },
        select: membershipSelect,
      });
      return { status: 'COMPLETED', session: toSession(membership) };
    });
  }

  public async consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
    const consumed = await this.prisma.mfaRecoveryCode.updateMany({
      where: {
        userId,
        codeHash,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    return consumed.count === 1;
  }

  public async createPasswordReset(
    email: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);
  }

  public async resetPassword(
    tokenHash: string,
    passwordHash: string,
  ): Promise<ResetPasswordResult> {
    return this.prisma.$transaction(async (transaction) => {
      const reset = await transaction.passwordResetToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              memberships: {
                select: { id: true, tenantId: true },
              },
            },
          },
        },
      });

      if (!reset) {
        return { status: 'NOT_FOUND' };
      }
      if (reset.usedAt) {
        return { status: 'USED' };
      }
      if (reset.expiresAt.getTime() <= Date.now()) {
        return { status: 'EXPIRED' };
      }
      if (reset.user.status !== 'ACTIVE') {
        return { status: 'BLOCKED' };
      }

      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        return { status: 'CONCURRENT' };
      }

      await transaction.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash,
          securityVersion: { increment: 1 },
        },
      });
      await transaction.refreshSession.updateMany({
        where: {
          membership: { userId: reset.userId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await transaction.mfaChallenge.updateMany({
        where: { userId: reset.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      for (const membership of reset.user.memberships) {
        await transaction.auditLog.create({
          data: {
            tenantId: membership.tenantId,
            actorId: reset.userId,
            action: 'auth.password.reset',
            entityType: 'user',
            entityId: reset.userId,
          },
        });
      }

      return { status: 'RESET' };
    });
  }
}
