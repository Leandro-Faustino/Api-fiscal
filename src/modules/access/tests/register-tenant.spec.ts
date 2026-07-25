import { describe, expect, it } from 'vitest';
import type { PasswordHasher } from '../application/ports/password-hasher.js';
import { RegisterTenantUseCase } from '../application/use-cases/register-tenant.js';
import { FakeAccessRepository } from './fakes.js';

const passwordHasher: PasswordHasher = {
  hash: async () => 'encoded-password',
  verify: async () => true,
};

describe('RegisterTenantUseCase', () => {
  it('normaliza os dados e cria o proprietário sem persistir a senha aberta', async () => {
    const accessRepository = new FakeAccessRepository();
    const useCase = new RegisterTenantUseCase({ accessRepository, passwordHasher });

    await useCase.execute({
      tenantName: '  Escritório Fiscal  ',
      tenantSlug: 'escritorio-fiscal',
      userName: '  Leandro  ',
      email: '  LEANDRO@EXAMPLE.COM ',
      password: 'SenhaSegura123',
    });

    expect(accessRepository.registerTenantInput).toEqual({
      tenantName: 'Escritório Fiscal',
      tenantSlug: 'escritorio-fiscal',
      userName: 'Leandro',
      email: 'leandro@example.com',
      passwordHash: 'encoded-password',
    });
  });

  it('rejeita senha abaixo da política mínima', async () => {
    const useCase = new RegisterTenantUseCase({
      accessRepository: new FakeAccessRepository(),
      passwordHasher,
    });

    await expect(
      useCase.execute({
        tenantName: 'Escritório Fiscal',
        tenantSlug: 'escritorio-fiscal',
        userName: 'Leandro',
        email: 'leandro@example.com',
        password: 'fraca',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
