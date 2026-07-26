import { describe, expect, it, vi } from 'vitest';
import type { CredentialCipher } from '../../credentials/application/ports/credential-cipher.js';
import type { EcacSitfisProcessRepository } from '../application/ports/ecac-sitfis-process-repository.js';
import { RotateSitfisProtocolKeysUseCase } from '../application/use-cases/rotate-sitfis-protocol-keys.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const processId = '10000000-0000-4000-8000-000000000003';
const jobId = '10000000-0000-4000-8000-000000000004';

function repository(): EcacSitfisProcessRepository {
  return {
    find: vi.fn(async () => null),
    saveCheckpointWithAudit: vi.fn(async () => undefined),
    resetProtocolWithAudit: vi.fn(async () => undefined),
    listEncryptedForRotation: vi.fn(async () => []),
    rotateEncryptionWithAudit: vi.fn(async () => false),
  };
}

describe('rotação dos protocolos SITFIS', () => {
  it('recifra o protocolo com o mesmo contexto do job e apaga o buffer', async () => {
    const plaintext = Buffer.from('protocolo-sitfis');
    const open = vi.fn(() => Buffer.from(plaintext));
    const seal = vi.fn((value: Buffer, context: string) => ({
      ciphertext: `v2:${context}:${value.length}`,
      keyVersion: 2,
    }));
    const cipher: CredentialCipher = {
      open,
      seal,
      getActiveKeyVersion: vi.fn(() => 2),
    };
    const rotateEncryptionWithAudit = vi.fn(async () => true);
    const sitfisRepository: EcacSitfisProcessRepository = {
      ...repository(),
      listEncryptedForRotation: vi.fn(async () => [
        {
          id: processId,
          jobId,
          encryptedProtocol: 'sealed-v1',
          protocolKeyVersion: 1,
        },
      ]),
      rotateEncryptionWithAudit,
    };
    const useCase = new RotateSitfisProtocolKeysUseCase({
      credentialCipher: cipher,
      ecacSitfisProcessRepository: sitfisRepository,
    });

    const result = await useCase.execute({ tenantId, actorId });

    const context = `tenant:${tenantId}:ecac:sitfis:${jobId}:protocol`;
    expect(open).toHaveBeenCalledWith('sealed-v1', context);
    expect(seal).toHaveBeenCalledWith(expect.any(Buffer), context);
    expect(rotateEncryptionWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        processId,
        actorId,
        expectedKeyVersion: 1,
        targetKeyVersion: 2,
      }),
    );
    expect(result).toEqual({
      targetKeyVersion: 2,
      scanned: 1,
      rotated: 1,
      skippedByConcurrency: 0,
      hasMore: false,
    });
  });

  it('rejeita lote fora do limite antes de consultar o banco', async () => {
    const sitfisRepository = repository();
    const useCase = new RotateSitfisProtocolKeysUseCase({
      credentialCipher: {
        open: vi.fn(),
        seal: vi.fn(),
        getActiveKeyVersion: vi.fn(() => 2),
      },
      ecacSitfisProcessRepository: sitfisRepository,
    });

    await expect(
      useCase.execute({ tenantId, actorId, limit: 101 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(sitfisRepository.listEncryptedForRotation).not.toHaveBeenCalled();
  });
});
