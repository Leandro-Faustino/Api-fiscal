import type { AccessSession } from '../../domain/access.js';
import {
  normalizeEmail,
  normalizeTenantSlug,
  validateName,
  validatePassword,
} from '../access-validation.js';
import type { AccessRepository } from '../ports/access-repository.js';
import type { PasswordHasher } from '../ports/password-hasher.js';

interface Dependencies {
  accessRepository: AccessRepository;
  passwordHasher: PasswordHasher;
}

export interface RegisterTenantInput {
  tenantName: string;
  tenantSlug: string;
  userName: string;
  email: string;
  password: string;
}

export class RegisterTenantUseCase {
  private readonly accessRepository: AccessRepository;
  private readonly passwordHasher: PasswordHasher;

  public constructor({ accessRepository, passwordHasher }: Dependencies) {
    this.accessRepository = accessRepository;
    this.passwordHasher = passwordHasher;
  }

  public async execute(input: RegisterTenantInput): Promise<AccessSession> {
    validatePassword(input.password);
    const passwordHash = await this.passwordHasher.hash(input.password);

    return this.accessRepository.registerTenant({
      tenantName: validateName(input.tenantName, 'O nome do escritório'),
      tenantSlug: normalizeTenantSlug(input.tenantSlug),
      userName: validateName(input.userName, 'O nome do usuário'),
      email: normalizeEmail(input.email),
      passwordHash,
    });
  }
}
