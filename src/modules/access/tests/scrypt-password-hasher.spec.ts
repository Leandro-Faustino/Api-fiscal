import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from '../infra/security/scrypt-password-hasher.js';

describe('ScryptPasswordHasher', () => {
  it('gera salts diferentes e valida somente a senha correta', async () => {
    const hasher = new ScryptPasswordHasher();
    const firstHash = await hasher.hash('SenhaSegura123');
    const secondHash = await hasher.hash('SenhaSegura123');

    expect(firstHash).not.toBe(secondHash);
    await expect(hasher.verify('SenhaSegura123', firstHash)).resolves.toBe(true);
    await expect(hasher.verify('SenhaErrada123', firstHash)).resolves.toBe(false);
  });
});
