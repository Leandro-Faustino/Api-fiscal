import type { RefreshSessionRepository } from '../ports/refresh-session-repository.js';
import { hashRefreshToken } from './create-refresh-session.js';

interface Dependencies {
  refreshSessionRepository: RefreshSessionRepository;
}

export class RevokeRefreshSessionUseCase {
  private readonly repository: RefreshSessionRepository;

  public constructor({ refreshSessionRepository }: Dependencies) {
    this.repository = refreshSessionRepository;
  }

  public async execute(refreshToken: string): Promise<void> {
    await this.repository.revoke(hashRefreshToken(refreshToken));
  }
}
