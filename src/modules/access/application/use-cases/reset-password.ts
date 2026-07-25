import { UnauthorizedError } from '../../../../shared/domain/app-error.js';
import { validatePassword } from '../access-validation.js';
import type { MfaService } from '../ports/mfa-service.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SecurityRepository } from '../ports/security-repository.js';

interface Dependencies {
  securityRepository: SecurityRepository;
  mfaService: MfaService;
  passwordHasher: PasswordHasher;
}

export class ResetPasswordUseCase {
  private readonly repository: SecurityRepository;
  private readonly mfaService: MfaService;
  private readonly passwordHasher: PasswordHasher;

  public constructor({
    securityRepository,
    mfaService,
    passwordHasher,
  }: Dependencies) {
    this.repository = securityRepository;
    this.mfaService = mfaService;
    this.passwordHasher = passwordHasher;
  }

  public async execute(token: string, password: string): Promise<void> {
    validatePassword(password);
    const passwordHash = await this.passwordHasher.hash(password);
    const result = await this.repository.resetPassword(
      this.mfaService.hash(token),
      passwordHash,
    );

    if (result.status !== 'RESET') {
      throw new UnauthorizedError(
        'Token de recuperação inválido ou expirado.',
        'INVALID_PASSWORD_RESET_TOKEN',
      );
    }
  }
}
