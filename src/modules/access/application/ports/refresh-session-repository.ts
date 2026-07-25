import type { AccessSession } from '../../domain/access.js';

export interface RefreshSessionMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface CreateRefreshSessionInput extends RefreshSessionMetadata {
  familyId: string;
  membershipId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RotateRefreshSessionInput extends RefreshSessionMetadata {
  currentTokenHash: string;
  newTokenHash: string;
  newExpiresAt: Date;
}

export type RotateRefreshSessionResult =
  | { status: 'ROTATED'; session: AccessSession }
  | {
      status:
        | 'NOT_FOUND'
        | 'EXPIRED'
        | 'REVOKED'
        | 'REUSED'
        | 'BLOCKED'
        | 'MFA_REQUIRED';
    };

export interface RefreshSessionRepository {
  create(input: CreateRefreshSessionInput): Promise<void>;
  rotate(input: RotateRefreshSessionInput): Promise<RotateRefreshSessionResult>;
  revoke(tokenHash: string): Promise<void>;
}
