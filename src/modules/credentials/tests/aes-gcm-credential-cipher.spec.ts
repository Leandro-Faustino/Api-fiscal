import { describe, expect, it } from 'vitest';
import { AesGcmCredentialCipher } from '../infra/security/aes-gcm-credential-cipher.js';

function createCipher(): AesGcmCredentialCipher {
  return new AesGcmCredentialCipher({
    credentialVaultMasterKey: Buffer.alloc(32, 21).toString('base64'),
    credentialVaultKeyVersion: 3,
  });
}

describe('cofre AES-GCM', () => {
  it('cifra e abre bytes somente com o mesmo contexto', () => {
    const cipher = createCipher();
    const plaintext = Buffer.from('segredo que não pode aparecer no banco');
    const sealed = cipher.seal(plaintext, 'tenant:certificate:bundle');

    expect(sealed.keyVersion).toBe(3);
    expect(sealed.ciphertext).not.toContain(plaintext.toString());
    expect(
      cipher.open(sealed.ciphertext, 'tenant:certificate:bundle').equals(plaintext),
    ).toBe(true);
    expect(() =>
      cipher.open(sealed.ciphertext, 'outro-tenant:certificate:bundle'),
    ).toThrow();
  });

  it('detecta adulteração do conteúdo cifrado', () => {
    const cipher = createCipher();
    const sealed = cipher.seal(Buffer.from('segredo'), 'contexto');
    const parts = sealed.ciphertext.split('.');
    const encrypted = Buffer.from(parts[4]!, 'base64url');
    encrypted[0] = encrypted[0]! ^ 0x01;
    parts[4] = encrypted.toString('base64url');

    expect(() => cipher.open(parts.join('.'), 'contexto')).toThrow();
  });

  it('abre versões anteriores e grava somente com a chave ativa', () => {
    const previousKey = Buffer.alloc(32, 31).toString('base64');
    const activeKey = Buffer.alloc(32, 32).toString('base64');
    const oldCipher = new AesGcmCredentialCipher({
      credentialVaultMasterKey: previousKey,
      credentialVaultKeyVersion: 1,
    });
    const oldSealed = oldCipher.seal(Buffer.from('segredo legado'), 'contexto');
    const rotatingCipher = new AesGcmCredentialCipher({
      credentialVaultMasterKey: activeKey,
      credentialVaultKeyVersion: 2,
      credentialVaultPreviousKeys: JSON.stringify({ 1: previousKey }),
    });

    expect(rotatingCipher.open(oldSealed.ciphertext, 'contexto').toString()).toBe(
      'segredo legado',
    );
    expect(rotatingCipher.seal(Buffer.from('novo segredo'), 'contexto').keyVersion).toBe(
      2,
    );
    expect(rotatingCipher.getActiveKeyVersion()).toBe(2);
  });

  it('falha de forma segura quando a chave histórica não está disponível', () => {
    const oldCipher = new AesGcmCredentialCipher({
      credentialVaultMasterKey: Buffer.alloc(32, 33).toString('base64'),
      credentialVaultKeyVersion: 1,
    });
    const oldSealed = oldCipher.seal(Buffer.from('segredo legado'), 'contexto');
    const newCipher = new AesGcmCredentialCipher({
      credentialVaultMasterKey: Buffer.alloc(32, 34).toString('base64'),
      credentialVaultKeyVersion: 2,
    });

    expect(() => newCipher.open(oldSealed.ciphertext, 'contexto')).toThrow(
      'chave indisponível',
    );
  });
});
