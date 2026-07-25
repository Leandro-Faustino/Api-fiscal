import { randomBytes } from 'node:crypto';
import { normalizeEmail } from '../access-validation.js';
import type { MfaService } from '../ports/mfa-service.js';
import type { SecurityRepository } from '../ports/security-repository.js';

interface Dependencies {
  securityRepository: SecurityRepository;
  mfaService: MfaService;
  passwordResetTtlMinutes: number;
}

export class RequestPasswordResetUseCase {
  private readonly repository: SecurityRepository;
  private readonly mfaService: MfaService;
  private readonly ttlMinutes: number;

  public constructor({
    securityRepository,
    mfaService,
    passwordResetTtlMinutes,
  }: Dependencies) {
    this.repository = securityRepository;
    this.mfaService = mfaService;
    this.ttlMinutes = passwordResetTtlMinutes;
  }

  public async execute(email: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1_000);

    await this.repository.createPasswordReset(
      normalizeEmail(email),
      this.mfaService.hash(token),
      expiresAt,
    );

    return { token, expiresAt };
  }
}
