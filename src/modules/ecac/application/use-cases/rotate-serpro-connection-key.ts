import { AppError } from '../../../../shared/domain/app-error.js';
import type { CredentialCipher } from '../../../credentials/application/ports/credential-cipher.js';
import type { SerproConnectionRepository } from '../ports/serpro-connection-repository.js';

interface Dependencies {
  serproConnectionRepository: SerproConnectionRepository;
  credentialCipher: CredentialCipher;
}

export interface RotateSerproConnectionKeyInput {
  tenantId: string;
  actorId: string;
}

export interface RotateSerproConnectionKeyResult {
  targetKeyVersion: number;
  rotated: boolean;
  skippedByConcurrency: boolean;
}

export class RotateSerproConnectionKeyUseCase {
  private readonly repository: SerproConnectionRepository;
  private readonly cipher: CredentialCipher;

  public constructor({
    serproConnectionRepository,
    credentialCipher,
  }: Dependencies) {
    this.repository = serproConnectionRepository;
    this.cipher = credentialCipher;
  }

  public async execute(
    input: RotateSerproConnectionKeyInput,
  ): Promise<RotateSerproConnectionKeyResult> {
    const targetKeyVersion = this.cipher.getActiveKeyVersion();
    const material = await this.repository.getEncryptedForRotation(
      input.tenantId,
      targetKeyVersion,
    );
    if (!material) {
      return {
        targetKeyVersion,
        rotated: false,
        skippedByConcurrency: false,
      };
    }

    let consumerKey: Buffer | undefined;
    let consumerSecret: Buffer | undefined;
    try {
      consumerKey = this.cipher.open(
        material.encryptedConsumerKey,
        `tenant:${input.tenantId}:serpro:consumer-key`,
      );
      consumerSecret = this.cipher.open(
        material.encryptedConsumerSecret,
        `tenant:${input.tenantId}:serpro:consumer-secret`,
      );
      const sealedKey = this.cipher.seal(
        consumerKey,
        `tenant:${input.tenantId}:serpro:consumer-key`,
      );
      const sealedSecret = this.cipher.seal(
        consumerSecret,
        `tenant:${input.tenantId}:serpro:consumer-secret`,
      );

      const rotated = await this.repository.rotateEncryptionWithAudit({
        tenantId: input.tenantId,
        connectionId: material.id,
        actorId: input.actorId,
        expectedKeyVersion: material.keyVersion,
        encryptedConsumerKey: sealedKey.ciphertext,
        encryptedConsumerSecret: sealedSecret.ciphertext,
        targetKeyVersion,
      });
      return {
        targetKeyVersion,
        rotated,
        skippedByConcurrency: !rotated,
      };
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'A versão de chave necessária para recifrar a conexão SERPRO não está disponível.',
        'SERPRO_CONNECTION_KEY_UNAVAILABLE',
        500,
        {
          connectionId: material.id,
          keyVersion: material.keyVersion,
        },
      );
    } finally {
      consumerKey?.fill(0);
      consumerSecret?.fill(0);
    }
  }
}
