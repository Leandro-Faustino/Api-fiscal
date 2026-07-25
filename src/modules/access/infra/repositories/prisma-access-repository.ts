import { Prisma, type PrismaClient } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
} from '../../../../shared/domain/app-error.js';
import type {
  AccessSession,
  AuthContext,
  Invitation,
  Member,
} from '../../domain/access.js';
import type {
  AcceptInvitationInput,
  AccessRepository,
  CreateInvitationInput,
  InvitationAcceptanceRecord,
  LoginRecord,
  RegisterTenantInput,
} from '../../application/ports/access-repository.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

const sessionSelect = {
  id: true,
  role: true,
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
      securityVersion: true,
      mfaEnabledAt: true,
    },
  },
} satisfies Prisma.MembershipSelect;

type SessionRecord = Prisma.MembershipGetPayload<{ select: typeof sessionSelect }>;

function toSession(record: SessionRecord): AccessSession {
  return {
    userId: record.user.id,
    membershipId: record.id,
    tenantId: record.tenant.id,
    tenantName: record.tenant.name,
    tenantSlug: record.tenant.slug,
    role: record.role,
    email: record.user.email,
    name: record.user.name,
    securityVersion: record.user.securityVersion,
    mfaEnabled: record.user.mfaEnabledAt !== null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class PrismaAccessRepository implements AccessRepository {
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async registerTenant(input: RegisterTenantInput): Promise<AccessSession> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const tenant = await transaction.tenant.create({
          data: {
            name: input.tenantName,
            slug: input.tenantSlug,
          },
        });
        const user = await transaction.user.create({
          data: {
            name: input.userName,
            email: input.email,
            passwordHash: input.passwordHash,
          },
        });
        const membership = await transaction.membership.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            role: 'OWNER',
          },
          select: sessionSelect,
        });

        await transaction.auditLog.create({
          data: {
            tenantId: tenant.id,
            actorId: user.id,
            action: 'tenant.registered',
            entityType: 'tenant',
            entityId: tenant.id,
            metadata: {
              slug: tenant.slug,
              ownerMembershipId: membership.id,
            },
          },
        });

        return toSession(membership);
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError(
          'O e-mail ou identificador do escritório já está em uso.',
          'ACCESS_REGISTRATION_CONFLICT',
        );
      }

      throw error;
    }
  }

  public async findLoginRecord(email: string, tenantSlug: string): Promise<LoginRecord | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        tenant: { slug: tenantSlug },
        user: { email },
      },
      select: {
        ...sessionSelect,
        status: true,
        user: {
          select: {
            ...sessionSelect.user.select,
            passwordHash: true,
            status: true,
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    return {
      ...toSession(membership),
      passwordHash: membership.user.passwordHash,
      userStatus: membership.user.status,
      membershipStatus: membership.status,
    };
  }

  public async recordSuccessfulLogin(userId: string, tenantId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'auth.login.succeeded',
          entityType: 'user',
          entityId: userId,
        },
      }),
    ]);
  }

  public async findAuthContext(
    userId: string,
    membershipId: string,
    tenantId: string,
    securityVersion: number,
  ): Promise<AuthContext | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        tenantId,
        userId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE', securityVersion },
      },
      select: sessionSelect,
    });

    return membership ? toSession(membership) : null;
  }

  public async hasPendingInvitation(tenantId: string, email: string): Promise<boolean> {
    const count = await this.prisma.invitation.count({
      where: {
        tenantId,
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    return count > 0;
  }

  public async createInvitation(input: CreateInvitationInput): Promise<Invitation> {
    return this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.invitation.create({
        data: input,
      });

      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.createdById,
          action: 'membership.invited',
          entityType: 'invitation',
          entityId: invitation.id,
          metadata: {
            email: input.email,
            role: input.role,
            expiresAt: input.expiresAt.toISOString(),
          },
        },
      });

      return invitation;
    });
  }

  public async findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<InvitationAcceptanceRecord | null> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        tenant: { select: { slug: true } },
      },
    });

    if (!invitation) {
      return null;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, passwordHash: true, status: true },
    });

    return {
      id: invitation.id,
      tenantId: invitation.tenantId,
      tenantSlug: invitation.tenant.slug,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      createdAt: invitation.createdAt,
      existingUserId: existingUser?.id ?? null,
      existingUserPasswordHash: existingUser?.passwordHash ?? null,
      existingUserStatus: existingUser?.status ?? null,
    };
  }

  public async acceptInvitation(input: AcceptInvitationInput): Promise<AccessSession> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const invitation = await transaction.invitation.findUnique({
          where: { id: input.invitationId },
        });

        if (!invitation) {
          throw new NotFoundError('Convite não encontrado.', 'INVITATION_NOT_FOUND');
        }

        if (invitation.acceptedAt) {
          throw new ConflictError('Este convite já foi utilizado.', 'INVITATION_ALREADY_ACCEPTED');
        }

        if (invitation.expiresAt.getTime() <= Date.now()) {
          throw new ConflictError('Este convite expirou.', 'INVITATION_EXPIRED');
        }

        const user = input.userId
          ? await transaction.user.findUniqueOrThrow({ where: { id: input.userId } })
          : await transaction.user.create({
              data: {
                name: input.userName,
                email: input.email,
                passwordHash: input.passwordHash!,
              },
            });

        const membership = await transaction.membership.create({
          data: {
            tenantId: invitation.tenantId,
            userId: user.id,
            role: invitation.role,
          },
          select: sessionSelect,
        });

        await transaction.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        await transaction.auditLog.create({
          data: {
            tenantId: invitation.tenantId,
            actorId: user.id,
            action: 'membership.accepted',
            entityType: 'membership',
            entityId: membership.id,
            metadata: { role: membership.role },
          },
        });

        return toSession(membership);
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError(
          'Este usuário já pertence ao escritório.',
          'MEMBERSHIP_ALREADY_EXISTS',
        );
      }

      throw error;
    }
  }

  public async listMembers(tenantId: string): Promise<Member[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      status: membership.status,
      createdAt: membership.createdAt,
    }));
  }
}
