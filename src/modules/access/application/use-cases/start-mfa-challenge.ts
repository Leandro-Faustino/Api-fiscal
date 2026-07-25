import { randomBytes } from 'node:crypto';
import type { AccessSession } from '../../domain/access.js';
import type { MfaService } from '../ports/mfa-service.js';
import type { SecurityRepository } from '../ports/security-repository.js';

interface Dependencies {
  securityRepository: SecurityRepository;
  mfaService: MfaService;
  mfaChallengeTtlMinutes: number;
  mfaIssuer: string;
}

export interface MfaChallengeResult {
  status: 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';
  challengeToken: string;
  expiresAt: Date;
  secret?: string;
  otpAuthUri?: string;
}

export function requiresMfa(session: AccessSession): boolean {
  return session.role === 'OWNER' || session.role === 'ADMIN';
}

export class StartMfaChallengeUseCase {
  private readonly repository: SecurityRepository;
  private readonly mfaService: MfaService;
  private readonly ttlMinutes: number;
  private readonly issuer: string;

  public constructor({
    securityRepository,
    mfaService,
    mfaChallengeTtlMinutes,
    mfaIssuer,
  }: Dependencies) {
    this.repository = securityRepository;
    this.mfaService = mfaService;
    this.ttlMinutes = mfaChallengeTtlMinutes;
    this.issuer = mfaIssuer;
  }

  public async execute(session: AccessSession): Promise<MfaChallengeResult> {
    const challengeToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1_000);
    const setupRequired = !session.mfaEnabled;
    const secret = setupRequired ? this.mfaService.generateSecret() : undefined;

    await this.repository.createMfaChallenge({
      type: setupRequired ? 'SETUP' : 'LOGIN',
      tokenHash: this.mfaService.hash(challengeToken),
      userId: session.userId,
      membershipId: session.membershipId,
      secretEncrypted: secret ? this.mfaService.encrypt(secret) : null,
      expiresAt,
    });

    if (!secret) {
      return {
        status: 'MFA_REQUIRED',
        challengeToken,
        expiresAt,
      };
    }

    return {
      status: 'MFA_SETUP_REQUIRED',
      challengeToken,
      expiresAt,
      secret,
      otpAuthUri: this.mfaService.buildOtpAuthUri(
        secret,
        `${session.email} (${session.tenantSlug})`,
        this.issuer,
      ),
    };
  }
}
