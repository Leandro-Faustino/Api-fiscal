import { UnauthorizedError } from '../../../../shared/domain/app-error.js';
import type { AccessSession } from '../../domain/access.js';
import type {
  RefreshSessionMetadata,
  RefreshSessionRepository,
} from '../ports/refresh-session-repository.js';
import {
  expiresInDays,
  generateRefreshToken,
  hashRefreshToken,
  type RefreshTokenResult,
} from './create-refresh-session.js';

interface Dependencies {
  refreshSessionRepository: RefreshSessionRepository;
  refreshTokenTtlDays: number;
}

export interface RotateRefreshTokenResult extends RefreshTokenResult {
  session: AccessSession;
}

export class RotateRefreshSessionUseCase {
  private readonly repository: RefreshSessionRepository;
  private readonly ttlDays: number;

  public constructor({ refreshSessionRepository, refreshTokenTtlDays }: Dependencies) {
    this.repository = refreshSessionRepository;
    this.ttlDays = refreshTokenTtlDays;
  }

  public async execute(
    refreshToken: string,
    metadata: RefreshSessionMetadata,
  ): Promise<RotateRefreshTokenResult> {
    const newRefreshToken = generateRefreshToken();
    const refreshExpiresAt = expiresInDays(this.ttlDays);
    const result = await this.repository.rotate({
      currentTokenHash: hashRefreshToken(refreshToken),
      newTokenHash: hashRefreshToken(newRefreshToken),
      newExpiresAt: refreshExpiresAt,
      ...metadata,
    });

    if (result.status !== 'ROTATED') {
      const errors = {
        NOT_FOUND: ['Refresh token inválido.', 'INVALID_REFRESH_TOKEN'],
        EXPIRED: ['Refresh token expirado.', 'REFRESH_TOKEN_EXPIRED'],
        REVOKED: ['Refresh token revogado.', 'REFRESH_TOKEN_REVOKED'],
        REUSED: [
          'Reutilização de refresh token detectada. A sessão foi revogada.',
          'REFRESH_TOKEN_REUSED',
        ],
        BLOCKED: ['Este acesso está bloqueado.', 'ACCESS_BLOCKED'],
        MFA_REQUIRED: [
          'Configure o MFA entrando novamente com sua senha.',
          'MFA_SETUP_REQUIRED',
        ],
      } as const;
      const [message, code] = errors[result.status];
      throw new UnauthorizedError(message, code);
    }

    return {
      session: result.session,
      refreshToken: newRefreshToken,
      refreshExpiresAt,
    };
  }
}
