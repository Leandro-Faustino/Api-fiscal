import { AppError, ValidationError } from '../../../../shared/domain/app-error.js';
import type { CredentialCipher } from '../../../credentials/application/ports/credential-cipher.js';
import type { EcacSitfisProcessRepository } from '../ports/ecac-sitfis-process-repository.js';

interface Dependencies {
  credentialCipher: CredentialCipher;
  ecacSitfisProcessRepository: EcacSitfisProcessRepository;
}

interface RotateSitfisProtocolKeysInput {
  tenantId: string;
  actorId: string;
  limit?: number;
}

export interface RotateSitfisProtocolKeysResult {
  targetKeyVersion: number;
  scanned: number;
  rotated: number;
  skippedByConcurrency: number;
  hasMore: boolean;
}

export class RotateSitfisProtocolKeysUseCase {
  private readonly cipher: CredentialCipher;
  private readonly repository: EcacSitfisProcessRepository;

  public constructor({
    credentialCipher,
    ecacSitfisProcessRepository,
  }: Dependencies) {
    this.cipher = credentialCipher;
    this.repository = ecacSitfisProcessRepository;
  }

  public async execute(
    input: RotateSitfisProtocolKeysInput,
  ): Promise<RotateSitfisProtocolKeysResult> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError(
        'O lote de rotação deve conter de 1 a 100 protocolos SITFIS.',
      );
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
      const context =
        `tenant:${input.tenantId}:ecac:sitfis:${material.jobId}:protocol`;
      let protocol: Buffer | undefined;
      try {
        protocol = this.cipher.open(material.encryptedProtocol, context);
        const sealed = this.cipher.seal(protocol, context);
        const updated = await this.repository.rotateEncryptionWithAudit({
          tenantId: input.tenantId,
          processId: material.id,
          jobId: material.jobId,
          actorId: input.actorId,
          expectedKeyVersion: material.protocolKeyVersion,
          encryptedProtocol: sealed.ciphertext,
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
          'A versão de chave necessária para recifrar o protocolo SITFIS não está disponível.',
          'ECAC_SITFIS_PROTOCOL_KEY_UNAVAILABLE',
          500,
          {
            processId: material.id,
            keyVersion: material.protocolKeyVersion,
          },
        );
      } finally {
        protocol?.fill(0);
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
