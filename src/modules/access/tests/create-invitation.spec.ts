import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CreateInvitationUseCase } from '../application/use-cases/create-invitation.js';
import { FakeAccessRepository, sessionFixture } from './fakes.js';

describe('CreateInvitationUseCase', () => {
  it('armazena apenas o hash do token e devolve o segredo uma única vez', async () => {
    const accessRepository = new FakeAccessRepository();
    const useCase = new CreateInvitationUseCase({
      accessRepository,
      invitationTtlHours: 72,
    });

    const result = await useCase.execute({
      tenantId: sessionFixture.tenantId,
      actorId: sessionFixture.userId,
      actorRole: 'OWNER',
      email: 'CONTADOR@EXAMPLE.COM',
      role: 'ACCOUNTANT',
    });

    expect(result.token).toHaveLength(43);
    expect(accessRepository.createInvitationInput?.tokenHash).toBe(
      createHash('sha256').update(result.token).digest('hex'),
    );
    expect(accessRepository.createInvitationInput?.tokenHash).not.toBe(result.token);
    expect(accessRepository.createInvitationInput?.email).toBe('contador@example.com');
  });

  it('impede administrador de convidar outro administrador', async () => {
    const useCase = new CreateInvitationUseCase({
      accessRepository: new FakeAccessRepository(),
      invitationTtlHours: 72,
    });

    await expect(
      useCase.execute({
        tenantId: sessionFixture.tenantId,
        actorId: sessionFixture.userId,
        actorRole: 'ADMIN',
        email: 'admin@example.com',
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });
});
