import { UnauthorizedError } from '../../../../shared/domain/app-error.js';
import type { AccessSession } from '../../domain/access.js';
import { normalizeEmail, normalizeTenantSlug } from '../access-validation.js';
import type { AccessRepository } from '../ports/access-repository.js';
import type { PasswordHasher } from '../ports/password-hasher.js';

interface Dependencies {
  accessRepository: AccessRepository;
  passwordHasher: PasswordHasher;
}

const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$-Z1ZrYWWOLCeT1G3Rutz4Q$VkWlEpieQYXdIX-toIR0h__xdu2Qxyg2XBApyXpSNWg3EF9LnjPjIcfcXm6dhFCQU-VsNicIX7bvpvkR1oP4sg';

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug: string;
}

export class LoginUseCase {
  private readonly accessRepository: AccessRepository;
  private readonly passwordHasher: PasswordHasher;

  public constructor({ accessRepository, passwordHasher }: Dependencies) {
    this.accessRepository = accessRepository;
    this.passwordHasher = passwordHasher;
  }

  public async execute(input: LoginInput): Promise<AccessSession> {
    const record = await this.accessRepository.findLoginRecord(
      normalizeEmail(input.email),
      normalizeTenantSlug(input.tenantSlug),
    );

    const passwordMatches = await this.passwordHasher.verify(
      input.password,
      record?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!record || !passwordMatches) {
      throw new UnauthorizedError('E-mail, senha ou escritório inválido.', 'INVALID_CREDENTIALS');
    }

    if (record.userStatus !== 'ACTIVE' || record.membershipStatus !== 'ACTIVE') {
      throw new UnauthorizedError('Este acesso está bloqueado.', 'ACCESS_BLOCKED');
    }

    if (record.role !== 'OWNER' && record.role !== 'ADMIN') {
      await this.accessRepository.recordSuccessfulLogin(record.userId, record.tenantId);
    }

    const {
      passwordHash: _passwordHash,
      userStatus: _userStatus,
      membershipStatus: _membershipStatus,
      ...session
    } = record;

    return session;
  }
}
