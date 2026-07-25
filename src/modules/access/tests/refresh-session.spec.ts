import { describe, expect, it } from 'vitest';
import type {
  CreateRefreshSessionInput,
  RefreshSessionRepository,
  RotateRefreshSessionInput,
  RotateRefreshSessionResult,
} from '../application/ports/refresh-session-repository.js';
import { CreateRefreshSessionUseCase } from '../application/use-cases/create-refresh-session.js';
import { RevokeRefreshSessionUseCase } from '../application/use-cases/revoke-refresh-session.js';
import { RotateRefreshSessionUseCase } from '../application/use-cases/rotate-refresh-session.js';
import { sessionFixture } from './fakes.js';

class FakeRefreshSessionRepository implements RefreshSessionRepository {
  public createInput: CreateRefreshSessionInput | null = null;
  public rotateInput: RotateRefreshSessionInput | null = null;
  public revokedHash: string | null = null;
  public rotateResult: RotateRefreshSessionResult = {
    status: 'ROTATED',
    session: sessionFixture,
  };

  public async create(input: CreateRefreshSessionInput): Promise<void> {
    this.createInput = input;
  }

  public async rotate(
    input: RotateRefreshSessionInput,
  ): Promise<RotateRefreshSessionResult> {
    this.rotateInput = input;
    return this.rotateResult;
  }

  public async revoke(tokenHash: string): Promise<void> {
    this.revokedHash = tokenHash;
  }
}

const metadata = {
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

describe('ciclo de refresh token', () => {
  it('cria token aleatório e persiste somente o hash', async () => {
    const repository = new FakeRefreshSessionRepository();
    const useCase = new CreateRefreshSessionUseCase({
      refreshSessionRepository: repository,
      refreshTokenTtlDays: 30,
    });

    const result = await useCase.execute(sessionFixture, metadata);

    expect(result.refreshToken).toHaveLength(64);
    expect(repository.createInput).toMatchObject({
      membershipId: sessionFixture.membershipId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    expect(repository.createInput?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.createInput?.tokenHash).not.toBe(result.refreshToken);
  });

  it('rotaciona o token sem reaproveitar o valor anterior', async () => {
    const repository = new FakeRefreshSessionRepository();
    const useCase = new RotateRefreshSessionUseCase({
      refreshSessionRepository: repository,
      refreshTokenTtlDays: 30,
    });

    const result = await useCase.execute('a'.repeat(64), metadata);

    expect(result.session).toEqual(sessionFixture);
    expect(result.refreshToken).not.toBe('a'.repeat(64));
    expect(repository.rotateInput?.currentTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.rotateInput?.newTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.rotateInput?.newTokenHash).not.toBe(
      repository.rotateInput?.currentTokenHash,
    );
  });

  it('revoga toda a sessão quando detecta reutilização', async () => {
    const repository = new FakeRefreshSessionRepository();
    repository.rotateResult = { status: 'REUSED' };
    const useCase = new RotateRefreshSessionUseCase({
      refreshSessionRepository: repository,
      refreshTokenTtlDays: 30,
    });

    await expect(useCase.execute('b'.repeat(64), metadata)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
      statusCode: 401,
    });
  });

  it('logout é idempotente e envia somente o hash ao repositório', async () => {
    const repository = new FakeRefreshSessionRepository();
    const useCase = new RevokeRefreshSessionUseCase({
      refreshSessionRepository: repository,
    });

    await useCase.execute('c'.repeat(64));

    expect(repository.revokedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.revokedHash).not.toBe('c'.repeat(64));
  });
});
