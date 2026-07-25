import { UnauthorizedError } from '../../../../shared/domain/app-error.js';
import type { AccessSession } from '../../domain/access.js';
import type { MfaService } from '../ports/mfa-service.js';
import type { SecurityRepository } from '../ports/security-repository.js';

interface Dependencies {
  securityRepository: SecurityRepository;
  mfaService: MfaService;
  mfaMaximumAttempts: number;
}

export interface VerifyMfaResult {
  session: AccessSession;
  recoveryCodes?: string[];
}

export class VerifyMfaChallengeUseCase {
  private readonly repository: SecurityRepository;
  private readonly mfaService: MfaService;
  private readonly maximumAttempts: number;

  public constructor({
    securityRepository,
    mfaService,
    mfaMaximumAttempts,
  }: Dependencies) {
    this.repository = securityRepository;
    this.mfaService = mfaService;
    this.maximumAttempts = mfaMaximumAttempts;
  }

  public async execute(challengeToken: string, code: string): Promise<VerifyMfaResult> {
    const challenge = await this.repository.findMfaChallenge(
      this.mfaService.hash(challengeToken),
    );

    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.failedAttempts >= this.maximumAttempts
    ) {
      throw new UnauthorizedError(
        'Desafio MFA inválido ou expirado.',
        'INVALID_MFA_CHALLENGE',
      );
    }

    let verified = false;
    if (challenge.type === 'SETUP') {
      verified =
        challenge.secretEncrypted !== null &&
        this.mfaService.verifyTotp(
          this.mfaService.decrypt(challenge.secretEncrypted),
          code,
        );
    } else if (/^\d{6}$/u.test(code)) {
      if (!challenge.userMfaSecretEncrypted) {
        throw new UnauthorizedError(
          'Configuração MFA inválida.',
          'INVALID_MFA_CONFIGURATION',
        );
      }
      verified = this.mfaService.verifyTotp(
        this.mfaService.decrypt(challenge.userMfaSecretEncrypted),
        code,
      );
    } else {
      verified = await this.repository.consumeRecoveryCode(
        challenge.session.userId,
        this.mfaService.hash(code.trim().toUpperCase()),
      );
    }

    if (!verified) {
      await this.repository.recordFailedMfaAttempt(
        challenge.id,
        this.maximumAttempts,
      );
      throw new UnauthorizedError('Código MFA inválido.', 'INVALID_MFA_CODE');
    }

    const recoveryCodes =
      challenge.type === 'SETUP'
        ? this.mfaService.generateRecoveryCodes()
        : undefined;
    const result = await this.repository.completeMfaChallenge(
      challenge.id,
      recoveryCodes?.map((recoveryCode) => this.mfaService.hash(recoveryCode)),
    );

    if (result.status !== 'COMPLETED') {
      throw new UnauthorizedError(
        'Desafio MFA inválido ou expirado.',
        'INVALID_MFA_CHALLENGE',
      );
    }

    return recoveryCodes
      ? { session: result.session, recoveryCodes }
      : { session: result.session };
  }
}
