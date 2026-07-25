import { describe, expect, it } from 'vitest';
import type {
  CreateDigitalCertificateInput,
  DigitalCertificateRepository,
  EncryptedCertificateMaterial,
  RotateCertificateEncryptionInput,
} from '../application/ports/digital-certificate-repository.js';
import { RotateCredentialKeysUseCase } from '../application/use-cases/rotate-credential-keys.js';
import type { DigitalCertificate } from '../domain/digital-certificate.js';
import { AesGcmCredentialCipher } from '../infra/security/aes-gcm-credential-cipher.js';

const tenantId = '30000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000001';
const certificateId = '50000000-0000-4000-8000-000000000001';
const previousKey = Buffer.alloc(32, 41).toString('base64');
const activeKey = Buffer.alloc(32, 42).toString('base64');

class RotationRepository implements DigitalCertificateRepository {
  public material: EncryptedCertificateMaterial | null;
  public rotations: RotateCertificateEncryptionInput[] = [];

  public constructor(material: EncryptedCertificateMaterial | null) {
    this.material = material;
  }

  public async listEncryptedForRotation(
    requestedTenantId: string,
    targetKeyVersion: number,
    limit: number,
  ): Promise<EncryptedCertificateMaterial[]> {
    if (
      !this.material ||
      this.material.tenantId !== requestedTenantId ||
      this.material.keyVersion === targetKeyVersion ||
      limit < 1
    ) {
      return [];
    }
    return [this.material];
  }

  public async rotateEncryptionWithAudit(
    input: RotateCertificateEncryptionInput,
  ): Promise<boolean> {
    if (!this.material || this.material.keyVersion !== input.expectedKeyVersion) {
      return false;
    }
    this.rotations.push(input);
    this.material = {
      ...this.material,
      encryptedBundle: input.encryptedBundle,
      encryptedPassword: input.encryptedPassword,
      keyVersion: input.targetKeyVersion,
    };
    return true;
  }

  public async createWithAudit(
    _input: CreateDigitalCertificateInput,
  ): Promise<DigitalCertificate> {
    throw new Error('Não usado neste teste.');
  }

  public async findById(): Promise<DigitalCertificate | null> {
    return null;
  }

  public async list(): Promise<DigitalCertificate[]> {
    return [];
  }

  public async revokeWithAudit(): Promise<DigitalCertificate> {
    throw new Error('Não usado neste teste.');
  }
}

function oldMaterial(): EncryptedCertificateMaterial {
  const cipher = new AesGcmCredentialCipher({
    credentialVaultMasterKey: previousKey,
    credentialVaultKeyVersion: 1,
  });
  const prefix = `certificate:${tenantId}:${certificateId}`;
  return {
    id: certificateId,
    tenantId,
    encryptedBundle: cipher.seal(Buffer.from('pfx-antigo'), `${prefix}:bundle`)
      .ciphertext,
    encryptedPassword: cipher.seal(
      Buffer.from('senha-antiga'),
      `${prefix}:password`,
    ).ciphertext,
    keyVersion: 1,
  };
}

function rotatingCipher(includePreviousKey = true): AesGcmCredentialCipher {
  return new AesGcmCredentialCipher({
    credentialVaultMasterKey: activeKey,
    credentialVaultKeyVersion: 2,
    credentialVaultPreviousKeys: includePreviousKey
      ? JSON.stringify({ 1: previousKey })
      : '{}',
  });
}

describe('rotação das chaves do cofre', () => {
  it('recifra pacote e senha com a chave ativa sem expor o conteúdo', async () => {
    const repository = new RotationRepository(oldMaterial());
    const cipher = rotatingCipher();
    const useCase = new RotateCredentialKeysUseCase({
      credentialCipher: cipher,
      digitalCertificateRepository: repository,
    });

    const result = await useCase.execute({ tenantId, actorId });

    expect(result).toEqual({
      targetKeyVersion: 2,
      scanned: 1,
      rotated: 1,
      skippedByConcurrency: 0,
      hasMore: false,
    });
    expect(repository.rotations).toHaveLength(1);
    expect(repository.material?.keyVersion).toBe(2);
    const prefix = `certificate:${tenantId}:${certificateId}`;
    expect(
      cipher.open(repository.material!.encryptedBundle, `${prefix}:bundle`).toString(),
    ).toBe('pfx-antigo');
    expect(
      cipher
        .open(repository.material!.encryptedPassword, `${prefix}:password`)
        .toString(),
    ).toBe('senha-antiga');
  });

  it('é idempotente quando todos os certificados já usam a chave ativa', async () => {
    const repository = new RotationRepository(null);
    const useCase = new RotateCredentialKeysUseCase({
      credentialCipher: rotatingCipher(),
      digitalCertificateRepository: repository,
    });

    await expect(useCase.execute({ tenantId, actorId })).resolves.toMatchObject({
      scanned: 0,
      rotated: 0,
      hasMore: false,
    });
  });

  it('interrompe com erro controlado se a chave anterior estiver ausente', async () => {
    const repository = new RotationRepository(oldMaterial());
    const useCase = new RotateCredentialKeysUseCase({
      credentialCipher: rotatingCipher(false),
      digitalCertificateRepository: repository,
    });

    await expect(useCase.execute({ tenantId, actorId })).rejects.toMatchObject({
      code: 'CREDENTIAL_KEY_UNAVAILABLE',
      statusCode: 500,
    });
    expect(repository.rotations).toHaveLength(0);
  });
});
