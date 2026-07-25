import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccessSession } from '../../domain/access.js';
import type {
  RefreshSessionMetadata,
  RefreshSessionRepository,
} from '../ports/refresh-session-repository.js';

interface Dependencies {
  refreshSessionRepository: RefreshSessionRepository;
  refreshTokenTtlDays: number;
}

export interface RefreshTokenResult {
  refreshToken: string;
  refreshExpiresAt: Date;
}

export class CreateRefreshSessionUseCase {
  private readonly repository: RefreshSessionRepository;
  private readonly ttlDays: number;

  public constructor({ refreshSessionRepository, refreshTokenTtlDays }: Dependencies) {
    this.repository = refreshSessionRepository;
    this.ttlDays = refreshTokenTtlDays;
  }

  public async execute(
    session: AccessSession,
    metadata: RefreshSessionMetadata,
  ): Promise<RefreshTokenResult> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = expiresInDays(this.ttlDays);

    await this.repository.create({
      familyId: randomUUID(),
      membershipId: session.membershipId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      ...metadata,
    });

    return { refreshToken, refreshExpiresAt };
  }
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function expiresInDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
}
