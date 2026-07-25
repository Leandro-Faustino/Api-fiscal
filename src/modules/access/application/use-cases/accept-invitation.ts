import { createHash } from 'node:crypto';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../../../shared/domain/app-error.js';
import type { AccessSession } from '../../domain/access.js';
import { validateName, validatePassword } from '../access-validation.js';
import type { AccessRepository } from '../ports/access-repository.js';
import type { PasswordHasher } from '../ports/password-hasher.js';

interface Dependencies {
  accessRepository: AccessRepository;
  passwordHasher: PasswordHasher;
}

export interface AcceptInvitationInput {
  token: string;
  userName: string;
  password: string;
}

export class AcceptInvitationUseCase {
  private readonly accessRepository: AccessRepository;
  private readonly passwordHasher: PasswordHasher;

  public constructor({ accessRepository, passwordHasher }: Dependencies) {
    this.accessRepository = accessRepository;
    this.passwordHasher = passwordHasher;
  }

  public async execute(input: AcceptInvitationInput): Promise<AccessSession> {
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const invitation = await this.accessRepository.findInvitationByTokenHash(tokenHash);

    if (!invitation) {
      throw new NotFoundError('Convite não encontrado.', 'INVITATION_NOT_FOUND');
    }

    if (invitation.acceptedAt) {
      throw new ConflictError('Este convite já foi utilizado.', 'INVITATION_ALREADY_ACCEPTED');
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Este convite expirou.', 'INVITATION_EXPIRED');
    }

    if (invitation.existingUserStatus === 'BLOCKED') {
      throw new UnauthorizedError('Este usuário está bloqueado.', 'ACCESS_BLOCKED');
    }

    validatePassword(input.password);

    if (
      invitation.existingUserPasswordHash &&
      !(await this.passwordHasher.verify(input.password, invitation.existingUserPasswordHash))
    ) {
      throw new UnauthorizedError(
        'A senha não corresponde ao usuário existente.',
        'INVALID_CREDENTIALS',
      );
    }

    const passwordHash = invitation.existingUserId
      ? null
      : await this.passwordHasher.hash(input.password);

    return this.accessRepository.acceptInvitation({
      invitationId: invitation.id,
      userId: invitation.existingUserId,
      userName: validateName(input.userName, 'O nome do usuário'),
      email: invitation.email,
      passwordHash,
    });
  }
}
