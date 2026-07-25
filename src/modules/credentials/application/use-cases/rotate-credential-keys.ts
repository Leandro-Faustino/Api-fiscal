import { AppError, ValidationError } from '../../../../shared/domain/app-error.js';
import type { CredentialCipher } from '../ports/credential-cipher.js';
import type { DigitalCertificateRepository } from '../ports/digital-certificate-repository.js';

interface Dependencies {
  credentialCipher: CredentialCipher;
  digitalCertificateRepository: DigitalCertificateRepository;
}

export interface RotateCredentialKeysInput {
  tenantId: string;
  actorId: string;
  limit?: number;
}

export interface RotateCredentialKeysResult {
  targetKeyVersion: number;
  scanned: number;
  rotated: number;
  skippedByConcurrency: number;
  hasMore: boolean;
}

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

export class RotateCredentialKeysUseCase {
  private readonly cipher: CredentialCipher;
  private readonly repository: DigitalCertificateRepository;

  public constructor({
    credentialCipher,
    digitalCertificateRepository,
  }: Dependencies) {
    this.cipher = credentialCipher;
    this.repository = digitalCertificateRepository;
  }

  public async execute(
    input: RotateCredentialKeysInput,
  ): Promise<RotateCredentialKeysResult> {
    const limit = input.limit ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
      throw new ValidationError('O lote de rotação deve conter de 1 a 100 certificados.');
    }

    const targetKeyVersion = this.cipher.getActiveKeyVersion();
    const materials = await this.repository.listEncryptedForRotation(
      input.tenantId,
      targetKeyVersion,
      limit + 1,
    );
    const selected = materials.slice(0, limit);
    let rotated = 0;
    let skippedByConcurrency = 0;

    for (const material of selected) {
      const contextPrefix = `certificate:${input.tenantId}:${material.id}`;
      let bundle: Buffer | undefined;
      let password: Buffer | undefined;

      try {
        bundle = this.cipher.open(
          material.encryptedBundle,
          `${contextPrefix}:bundle`,
        );
        password = this.cipher.open(
          material.encryptedPassword,
          `${contextPrefix}:password`,
        );
        const sealedBundle = this.cipher.seal(bundle, `${contextPrefix}:bundle`);
        const sealedPassword = this.cipher.seal(
          password,
          `${contextPrefix}:password`,
        );

        const updated = await this.repository.rotateEncryptionWithAudit({
          tenantId: input.tenantId,
          certificateId: material.id,
          actorId: input.actorId,
          expectedKeyVersion: material.keyVersion,
          encryptedBundle: sealedBundle.ciphertext,
          encryptedPassword: sealedPassword.ciphertext,
          targetKeyVersion,
        });

        if (updated) {
          rotated += 1;
        } else {
          skippedByConcurrency += 1;
        }
      } catch (error: unknown) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError(
          'Uma versão de chave necessária para a rotação não está disponível.',
          'CREDENTIAL_KEY_UNAVAILABLE',
          500,
          {
            certificateId: material.id,
            keyVersion: material.keyVersion,
          },
        );
      } finally {
        bundle?.fill(0);
        password?.fill(0);
      }
    }

    return {
      targetKeyVersion,
      scanned: selected.length,
      rotated,
      skippedByConcurrency,
      hasMore: materials.length > limit,
    };
  }
}
