import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type {
  CredentialCipher,
  SealedCredential,
} from '../../application/ports/credential-cipher.js';

interface Dependencies {
  credentialVaultMasterKey: string;
  credentialVaultKeyVersion: number;
  credentialVaultPreviousKeys?: string;
}

export class AesGcmCredentialCipher implements CredentialCipher {
  private readonly keys = new Map<number, Buffer>();
  private readonly activeKeyVersion: number;

  public constructor({
    credentialVaultMasterKey,
    credentialVaultKeyVersion,
    credentialVaultPreviousKeys = '{}',
  }: Dependencies) {
    this.activeKeyVersion = credentialVaultKeyVersion;
    this.keys.set(
      credentialVaultKeyVersion,
      this.decodeKey(credentialVaultMasterKey),
    );

    const previousKeys: unknown = JSON.parse(credentialVaultPreviousKeys);
    if (
      typeof previousKeys !== 'object' ||
      previousKeys === null ||
      Array.isArray(previousKeys)
    ) {
      throw new Error('As chaves anteriores do cofre são inválidas.');
    }

    for (const [versionText, encodedKey] of Object.entries(previousKeys)) {
      const version = Number(versionText);
      if (
        !Number.isSafeInteger(version) ||
        version <= 0 ||
        version === credentialVaultKeyVersion ||
        typeof encodedKey !== 'string'
      ) {
        throw new Error('As chaves anteriores do cofre são inválidas.');
      }
      this.keys.set(version, this.decodeKey(encodedKey));
    }
  }

  private decodeKey(encodedKey: string): Buffer {
    const normalized = encodedKey.trim();
    const key = Buffer.from(normalized, 'base64');
    if (key.length !== 32 || key.toString('base64') !== normalized) {
      throw new Error('A chave do cofre deve ter exatamente 32 bytes em Base64.');
    }
    return key;
  }

  public getActiveKeyVersion(): number {
    return this.activeKeyVersion;
  }

  public seal(plaintext: Buffer, context: string): SealedCredential {
    const iv = randomBytes(12);
    const key = this.keys.get(this.activeKeyVersion)!;
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return {
      keyVersion: this.activeKeyVersion,
      ciphertext: [
        'v1',
        String(this.activeKeyVersion),
        iv.toString('base64url'),
        authenticationTag.toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.'),
    };
  }

  public open(ciphertext: string, context: string): Buffer {
    const [formatVersion, keyVersionText, iv, authenticationTag, encrypted] =
      ciphertext.split('.');
    const keyVersion = Number(keyVersionText);
    const key = this.keys.get(keyVersion);

    if (
      formatVersion !== 'v1' ||
      !Number.isSafeInteger(keyVersion) ||
      !key ||
      !iv ||
      !authenticationTag ||
      encrypted === undefined
    ) {
      throw new Error('Credencial cifrada inválida ou chave indisponível.');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]);
  }
}
