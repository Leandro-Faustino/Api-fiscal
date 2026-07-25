import { createHash, randomBytes } from 'node:crypto';
import { ConflictError, ForbiddenError } from '../../../../shared/domain/app-error.js';
import type { Invitation, MembershipRole } from '../../domain/access.js';
import { canInviteRole } from '../../domain/permissions.js';
import { normalizeEmail } from '../access-validation.js';
import type { AccessRepository } from '../ports/access-repository.js';

interface Dependencies {
  accessRepository: AccessRepository;
  invitationTtlHours: number;
}

export interface CreateInvitationInput {
  tenantId: string;
  actorId: string;
  actorRole: MembershipRole;
  email: string;
  role: MembershipRole;
}

export interface CreatedInvitation {
  invitation: Invitation;
  token: string;
}

export class CreateInvitationUseCase {
  private readonly accessRepository: AccessRepository;
  private readonly invitationTtlHours: number;

  public constructor({ accessRepository, invitationTtlHours }: Dependencies) {
    this.accessRepository = accessRepository;
    this.invitationTtlHours = invitationTtlHours;
  }

  public async execute(input: CreateInvitationInput): Promise<CreatedInvitation> {
    if (!canInviteRole(input.actorRole, input.role)) {
      throw new ForbiddenError('Seu papel não pode convidar um usuário com esse nível de acesso.');
    }

    const email = normalizeEmail(input.email);

    if (await this.accessRepository.hasPendingInvitation(input.tenantId, email)) {
      throw new ConflictError(
        'Já existe um convite válido pendente para este e-mail.',
        'INVITATION_ALREADY_PENDING',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + this.invitationTtlHours * 60 * 60 * 1_000);
    const invitation = await this.accessRepository.createInvitation({
      tenantId: input.tenantId,
      createdById: input.actorId,
      email,
      role: input.role,
      tokenHash,
      expiresAt,
    });

    return { invitation, token };
  }
}
