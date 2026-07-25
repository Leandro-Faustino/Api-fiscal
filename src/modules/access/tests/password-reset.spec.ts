import { describe, expect, it } from 'vitest';
import type {
  CompleteMfaChallengeResult,
  CreateMfaChallengeInput,
  MfaChallengeRecord,
  ResetPasswordResult,
  SecurityRepository,
} from '../application/ports/security-repository.js';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import { RequestPasswordResetUseCase } from '../application/use-cases/request-password-reset.js';
import { ResetPasswordUseCase } from '../application/use-cases/reset-password.js';
import { TotpMfaService } from '../infra/security/totp-mfa-service.js';

class PasswordResetRepository implements SecurityRepository {
  public request: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
  } | null = null;
  public resetResult: ResetPasswordResult = { status: 'RESET' };
  public passwordHash: string | null = null;

  public async createMfaChallenge(_input: CreateMfaChallengeInput): Promise<void> {}
  public async findMfaChallenge(): Promise<MfaChallengeRecord | null> {
    return null;
  }
  public async recordFailedMfaAttempt(): Promise<void> {}
  public async completeMfaChallenge(): Promise<CompleteMfaChallengeResult> {
    return { status: 'NOT_FOUND' };
  }
  public async consumeRecoveryCode(): Promise<boolean> {
    return false;
  }
  public async createPasswordReset(
    email: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    this.request = { email, tokenHash, expiresAt };
  }
  public async resetPassword(
    _tokenHash: string,
    passwordHash: string,
  ): Promise<ResetPasswordResult> {
    this.passwordHash = passwordHash;
    return this.resetResult;
  }
}

describe('recuperação de senha', () => {
  it('normaliza o e-mail e persiste somente o hash do token', async () => {
    const repository = new PasswordResetRepository();
    const mfaService = new TotpMfaService({
      mfaEncryptionKey: 'password-reset-unit-test-key-with-32-characters',
    });
    const useCase = new RequestPasswordResetUseCase({
      securityRepository: repository,
      mfaService,
      passwordResetTtlMinutes: 15,
    });

    const result = await useCase.execute(' USER@EXAMPLE.COM ');

    expect(repository.request?.email).toBe('user@example.com');
    expect(repository.request?.tokenHash).not.toBe(result.token);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('valida a senha e rejeita token inválido com mensagem uniforme', async () => {
    const repository = new PasswordResetRepository();
    repository.resetResult = { status: 'EXPIRED' };
    const passwordHasher: PasswordHasher = {
      hash: async () => 'novo-hash',
      verify: async () => false,
    };
    const useCase = new ResetPasswordUseCase({
      securityRepository: repository,
      mfaService: new TotpMfaService({
        mfaEncryptionKey: 'password-reset-unit-test-key-with-32-characters',
      }),
      passwordHasher,
    });

    await expect(
      useCase.execute('token-invalido-com-tamanho-suficiente', 'NovaSenhaSegura123'),
    ).rejects.toMatchObject({
      code: 'INVALID_PASSWORD_RESET_TOKEN',
      statusCode: 401,
    });
    expect(repository.passwordHash).toBe('novo-hash');
  });
});
