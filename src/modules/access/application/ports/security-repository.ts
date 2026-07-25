import type { AccessSession } from '../../domain/access.js';

export type MfaChallengeKind = 'LOGIN' | 'SETUP';

export interface MfaChallengeRecord {
  id: string;
  type: MfaChallengeKind;
  session: AccessSession;
  secretEncrypted: string | null;
  userMfaSecretEncrypted: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  failedAttempts: number;
}

export interface CreateMfaChallengeInput {
  type: MfaChallengeKind;
  tokenHash: string;
  userId: string;
  membershipId: string;
  secretEncrypted: string | null;
  expiresAt: Date;
}

export type CompleteMfaChallengeResult =
  | { status: 'COMPLETED'; session: AccessSession }
  | { status: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'BLOCKED' | 'CONCURRENT' };

export type ResetPasswordResult =
  | { status: 'RESET' }
  | { status: 'NOT_FOUND' | 'EXPIRED' | 'USED' | 'BLOCKED' | 'CONCURRENT' };

export interface SecurityRepository {
  createMfaChallenge(input: CreateMfaChallengeInput): Promise<void>;
  findMfaChallenge(tokenHash: string): Promise<MfaChallengeRecord | null>;
  recordFailedMfaAttempt(challengeId: string, maximumAttempts: number): Promise<void>;
  completeMfaChallenge(
    challengeId: string,
    recoveryCodeHashes?: string[],
  ): Promise<CompleteMfaChallengeResult>;
  consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean>;
  createPasswordReset(
    email: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  resetPassword(tokenHash: string, passwordHash: string): Promise<ResetPasswordResult>;
}
