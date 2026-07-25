import { describe, expect, it } from 'vitest';
import type {
  CompleteMfaChallengeResult,
  CreateMfaChallengeInput,
  MfaChallengeRecord,
  ResetPasswordResult,
  SecurityRepository,
} from '../application/ports/security-repository.js';
import { StartMfaChallengeUseCase } from '../application/use-cases/start-mfa-challenge.js';
import { VerifyMfaChallengeUseCase } from '../application/use-cases/verify-mfa-challenge.js';
import {
  generateTotpCode,
  TotpMfaService,
} from '../infra/security/totp-mfa-service.js';
import { sessionFixture } from './fakes.js';

class FakeSecurityRepository implements SecurityRepository {
  public challengeInput: CreateMfaChallengeInput | null = null;
  public challenge: MfaChallengeRecord | null = null;
  public failedAttempts = 0;
  public completedRecoveryHashes: string[] = [];
  public recoveryCodeAccepted = false;

  public async createMfaChallenge(input: CreateMfaChallengeInput): Promise<void> {
    this.challengeInput = input;
    this.challenge = {
      id: '50000000-0000-4000-8000-000000000001',
      type: input.type,
      session: sessionFixture,
      secretEncrypted: input.secretEncrypted,
      userMfaSecretEncrypted: null,
      expiresAt: input.expiresAt,
      consumedAt: null,
      failedAttempts: 0,
    };
  }

  public async findMfaChallenge(): Promise<MfaChallengeRecord | null> {
    return this.challenge;
  }

  public async recordFailedMfaAttempt(): Promise<void> {
    this.failedAttempts += 1;
  }

  public async completeMfaChallenge(
    _challengeId: string,
    recoveryCodeHashes: string[] = [],
  ): Promise<CompleteMfaChallengeResult> {
    this.completedRecoveryHashes = recoveryCodeHashes;
    return {
      status: 'COMPLETED',
      session: {
        ...sessionFixture,
        securityVersion: 2,
        mfaEnabled: true,
      },
    };
  }

  public async consumeRecoveryCode(): Promise<boolean> {
    return this.recoveryCodeAccepted;
  }

  public async createPasswordReset(): Promise<void> {}

  public async resetPassword(): Promise<ResetPasswordResult> {
    return { status: 'RESET' };
  }
}

const encryptionKey = 'unit-test-mfa-encryption-key-with-32-characters';

describe('MFA privilegiado', () => {
  it('configura TOTP sem persistir o segredo em texto aberto', async () => {
    const repository = new FakeSecurityRepository();
    const mfaService = new TotpMfaService({ mfaEncryptionKey: encryptionKey });
    const start = new StartMfaChallengeUseCase({
      securityRepository: repository,
      mfaService,
      mfaChallengeTtlMinutes: 5,
      mfaIssuer: 'API Fiscal Test',
    });

    const challenge = await start.execute(sessionFixture);

    expect(challenge.status).toBe('MFA_SETUP_REQUIRED');
    expect(challenge.secret).toBeDefined();
    expect(challenge.otpAuthUri).toContain('otpauth://totp/');
    expect(repository.challengeInput?.secretEncrypted).not.toBe(challenge.secret);

    const verify = new VerifyMfaChallengeUseCase({
      securityRepository: repository,
      mfaService,
      mfaMaximumAttempts: 5,
    });
    const result = await verify.execute(
      challenge.challengeToken,
      generateTotpCode(challenge.secret!),
    );

    expect(result.session.mfaEnabled).toBe(true);
    expect(result.recoveryCodes).toHaveLength(8);
    expect(repository.completedRecoveryHashes).toHaveLength(8);
    expect(repository.completedRecoveryHashes).not.toContain(result.recoveryCodes![0]);
  });

  it('contabiliza tentativa inválida sem emitir sessão', async () => {
    const repository = new FakeSecurityRepository();
    const mfaService = new TotpMfaService({ mfaEncryptionKey: encryptionKey });
    repository.challenge = {
      id: '50000000-0000-4000-8000-000000000001',
      type: 'LOGIN',
      session: { ...sessionFixture, mfaEnabled: true },
      secretEncrypted: null,
      userMfaSecretEncrypted: mfaService.encrypt(mfaService.generateSecret()),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      failedAttempts: 0,
    };
    const verify = new VerifyMfaChallengeUseCase({
      securityRepository: repository,
      mfaService,
      mfaMaximumAttempts: 5,
    });

    await expect(
      verify.execute('desafio-valido-com-tamanho-suficiente', '000000'),
    ).rejects.toMatchObject({ code: 'INVALID_MFA_CODE' });
    expect(repository.failedAttempts).toBe(1);
  });

  it('criptografa o segredo com autenticação e detecta adulteração', () => {
    const service = new TotpMfaService({ mfaEncryptionKey: encryptionKey });
    const encrypted = service.encrypt('SEGREDO');
    const [version, iv, tag, ciphertext] = encrypted.split('.');
    const tamperedCiphertext = Buffer.from(ciphertext!, 'base64url');
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 1;
    const tampered = [
      version,
      iv,
      tag,
      tamperedCiphertext.toString('base64url'),
    ].join('.');

    expect(service.decrypt(encrypted)).toBe('SEGREDO');
    expect(() => service.decrypt(tampered)).toThrow();
  });
});
