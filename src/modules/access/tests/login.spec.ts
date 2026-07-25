import { describe, expect, it } from 'vitest';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import { LoginUseCase } from '../application/use-cases/login.js';
import { FakeAccessRepository, sessionFixture } from './fakes.js';

describe('LoginUseCase', () => {
  it('autentica vínculo ativo e registra o acesso', async () => {
    const accessRepository = new FakeAccessRepository();
    const accountantSession = {
      ...sessionFixture,
      role: 'ACCOUNTANT' as const,
    };
    accessRepository.loginRecord = {
      ...accountantSession,
      passwordHash: 'hash',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    };
    const passwordHasher: PasswordHasher = {
      hash: async () => 'hash',
      verify: async () => true,
    };
    const useCase = new LoginUseCase({ accessRepository, passwordHasher });

    const session = await useCase.execute({
      email: 'OWNER@EXAMPLE.COM',
      password: 'SenhaSegura123',
      tenantSlug: 'escritorio-teste',
    });

    expect(session).toEqual(accountantSession);
    expect(accessRepository.successfulLogin).toEqual({
      userId: sessionFixture.userId,
      tenantId: sessionFixture.tenantId,
    });
    expect(session).not.toHaveProperty('passwordHash');
  });

  it('não revela se e-mail, senha ou escritório causou a falha', async () => {
    const passwordHasher: PasswordHasher = {
      hash: async () => 'hash',
      verify: async () => false,
    };
    const useCase = new LoginUseCase({
      accessRepository: new FakeAccessRepository(),
      passwordHasher,
    });

    await expect(
      useCase.execute({
        email: 'owner@example.com',
        password: 'incorreta',
        tenantSlug: 'escritorio-teste',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });
  });
});
