import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CredentialCipher } from '../../credentials/application/ports/credential-cipher.js';
import type {
  ConfigureSerproConnectionInput,
  SerproConnectionRepository,
} from '../application/ports/serpro-connection-repository.js';
import { ConfigureSerproConnectionUseCase } from '../application/use-cases/configure-serpro-connection.js';
import { RotateSerproConnectionKeyUseCase } from '../application/use-cases/rotate-serpro-connection-key.js';
import type { SerproConnection } from '../domain/serpro-connection.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const certificateId = '10000000-0000-4000-8000-000000000003';
const testConsumerKey = randomBytes(24).toString('base64url');
const testConsumerSecret = randomBytes(36).toString('base64url');

function connection(input: ConfigureSerproConnectionInput): SerproConnection {
  return {
    id: input.id,
    tenantId: input.tenantId,
    certificateId: input.certificateId,
    contractorCnpj: input.contractorCnpj,
    requesterCnpj: input.requesterCnpj,
    status: 'ACTIVE',
    configuredById: input.actorId,
    revokedAt: null,
    createdAt: input.configuredAt,
    updatedAt: input.configuredAt,
  };
}

function repository(
  configureWithAudit: SerproConnectionRepository['configureWithAudit'],
): SerproConnectionRepository {
  return {
    configureWithAudit,
    find: vi.fn(async () => null),
    getMaterialForUse: vi.fn(async () => null),
    getEncryptedForRotation: vi.fn(async () => null),
    rotateEncryptionWithAudit: vi.fn(async () => false),
    recordUseWithAudit: vi.fn(async () => undefined),
  };
}

describe('configuração da conexão SERPRO', () => {
  it('normaliza CNPJs e cifra as credenciais antes do repositório', async () => {
    const configureWithAudit = vi.fn(async (input) => connection(input));
    const cipher: CredentialCipher = {
      seal: vi.fn((plaintext, context) => ({
        ciphertext: `sealed:${context}:${plaintext.length}`,
        keyVersion: 3,
      })),
      open: vi.fn(),
      getActiveKeyVersion: vi.fn(() => 3),
    };
    const useCase = new ConfigureSerproConnectionUseCase({
      serproConnectionRepository: repository(configureWithAudit),
      credentialCipher: cipher,
    });

    const result = await useCase.execute({
      tenantId,
      actorId,
      certificateId,
      contractorCnpj: '11.222.333/0001-81',
      requesterCnpj: '11.222.333/0001-81',
      consumerKey: ` ${testConsumerKey} `,
      consumerSecret: ` ${testConsumerSecret} `,
    });

    expect(result.contractorCnpj).toBe('11222333000181');
    expect(configureWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorId,
        certificateId,
        contractorCnpj: '11222333000181',
        requesterCnpj: '11222333000181',
        encryptedConsumerKey: expect.stringContaining('serpro:consumer-key'),
        encryptedConsumerSecret: expect.stringContaining('serpro:consumer-secret'),
        keyVersion: 3,
      }),
    );
  });

  it('rejeita CNPJ inválido antes de cifrar segredos', async () => {
    const cipher: CredentialCipher = {
      seal: vi.fn(),
      open: vi.fn(),
      getActiveKeyVersion: vi.fn(() => 1),
    };
    const useCase = new ConfigureSerproConnectionUseCase({
      serproConnectionRepository: repository(vi.fn()),
      credentialCipher: cipher,
    });

    await expect(
      useCase.execute({
        tenantId,
        actorId,
        certificateId,
        contractorCnpj: '00000000000000',
        requesterCnpj: '11222333000181',
        consumerKey: testConsumerKey,
        consumerSecret: testConsumerSecret,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(cipher.seal).not.toHaveBeenCalled();
  });

  it('recifra as duas credenciais de modo idempotente e protegido por versão', async () => {
    const rotateEncryptionWithAudit = vi.fn(async () => true);
    const serproConnectionRepository: SerproConnectionRepository = {
      ...repository(vi.fn()),
      getEncryptedForRotation: vi.fn(async () => ({
        id: '10000000-0000-4000-8000-000000000004',
        encryptedConsumerKey: 'sealed-key-v1',
        encryptedConsumerSecret: 'sealed-secret-v1',
        keyVersion: 1,
      })),
      rotateEncryptionWithAudit,
    };
    const cipher: CredentialCipher = {
      seal: vi.fn((plaintext, context) => ({
        ciphertext: `v2:${context}:${plaintext.length}`,
        keyVersion: 2,
      })),
      open: vi.fn((ciphertext) =>
        Buffer.from(
          ciphertext === 'sealed-key-v1'
            ? testConsumerKey
            : testConsumerSecret,
        ),
      ),
      getActiveKeyVersion: vi.fn(() => 2),
    };
    const useCase = new RotateSerproConnectionKeyUseCase({
      serproConnectionRepository,
      credentialCipher: cipher,
    });

    const result = await useCase.execute({ tenantId, actorId });

    expect(result).toEqual({
      targetKeyVersion: 2,
      rotated: true,
      skippedByConcurrency: false,
    });
    expect(rotateEncryptionWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorId,
        expectedKeyVersion: 1,
        targetKeyVersion: 2,
        encryptedConsumerKey: expect.stringContaining('serpro:consumer-key'),
        encryptedConsumerSecret: expect.stringContaining('serpro:consumer-secret'),
      }),
    );
  });
});
