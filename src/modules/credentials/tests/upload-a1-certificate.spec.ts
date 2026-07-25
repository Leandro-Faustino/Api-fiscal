import { describe, expect, it } from 'vitest';
import type { CertificateInspector } from '../application/ports/certificate-inspector.js';
import type {
  CreateDigitalCertificateInput,
  DigitalCertificateRepository,
  EncryptedCertificateMaterial,
  RotateCertificateEncryptionInput,
} from '../application/ports/digital-certificate-repository.js';
import { UploadA1CertificateUseCase } from '../application/use-cases/upload-a1-certificate.js';
import type { DigitalCertificate } from '../domain/digital-certificate.js';
import { AesGcmCredentialCipher } from '../infra/security/aes-gcm-credential-cipher.js';

const inspection = {
  fingerprintSha256: 'a'.repeat(64),
  serialNumber: '1234',
  subjectCommonName: 'Empresa Teste',
  issuerCommonName: 'AC Teste',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validUntil: new Date('2028-01-01T00:00:00.000Z'),
};

class FakeCertificateRepository implements DigitalCertificateRepository {
  public input: CreateDigitalCertificateInput | null = null;

  public async createWithAudit(
    input: CreateDigitalCertificateInput,
  ): Promise<DigitalCertificate> {
    this.input = input;
    return {
      id: input.id,
      tenantId: input.tenantId,
      label: input.label,
      kind: 'A1',
      status: 'ACTIVE',
      ...input.inspection,
      companyIds: input.companyIds,
      uploadedById: input.actorId,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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

  public async listEncryptedForRotation(): Promise<EncryptedCertificateMaterial[]> {
    return [];
  }

  public async rotateEncryptionWithAudit(
    _input: RotateCertificateEncryptionInput,
  ): Promise<boolean> {
    return false;
  }
}

describe('cadastro seguro de certificado A1', () => {
  it('persiste apenas o pacote e a senha cifrados', async () => {
    const repository = new FakeCertificateRepository();
    const certificateInspector: CertificateInspector = {
      inspect: () => inspection,
    };
    const credentialCipher = new AesGcmCredentialCipher({
      credentialVaultMasterKey: Buffer.alloc(32, 17).toString('base64'),
      credentialVaultKeyVersion: 2,
    });
    const useCase = new UploadA1CertificateUseCase({
      certificateInspector,
      credentialCipher,
      digitalCertificateRepository: repository,
    });
    const rawBundle = Buffer.from('conteudo-pfx-teste');
    const password = 'senha-do-pfx';

    const result = await useCase.execute({
      tenantId: '30000000-0000-4000-8000-000000000001',
      actorId: '10000000-0000-4000-8000-000000000001',
      label: '  Certificado principal  ',
      pfxBase64: rawBundle.toString('base64'),
      password,
      companyIds: ['40000000-0000-4000-8000-000000000001'],
    });

    expect(result).toMatchObject({
      label: 'Certificado principal',
      lifecycle: 'ACTIVE',
      fingerprintSha256: inspection.fingerprintSha256,
    });
    expect(repository.input?.keyVersion).toBe(2);
    expect(repository.input?.encryptedBundle).not.toContain(rawBundle.toString());
    expect(repository.input?.encryptedPassword).not.toContain(password);
  });

  it('rejeita escopo vazio, repetido e Base64 inválido', async () => {
    const repository = new FakeCertificateRepository();
    const useCase = new UploadA1CertificateUseCase({
      certificateInspector: { inspect: () => inspection },
      credentialCipher: new AesGcmCredentialCipher({
        credentialVaultMasterKey: Buffer.alloc(32, 17).toString('base64'),
        credentialVaultKeyVersion: 1,
      }),
      digitalCertificateRepository: repository,
    });
    const base = {
      tenantId: '30000000-0000-4000-8000-000000000001',
      actorId: '10000000-0000-4000-8000-000000000001',
      label: 'Certificado',
      pfxBase64: Buffer.from('pfx').toString('base64'),
      password: 'senha',
    };

    await expect(useCase.execute({ ...base, companyIds: [] })).rejects.toThrow(
      'Informe de 1 a 300 empresas distintas',
    );
    await expect(
      useCase.execute({
        ...base,
        companyIds: [
          '40000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001',
        ],
      }),
    ).rejects.toThrow('Informe de 1 a 300 empresas distintas');
    await expect(
      useCase.execute({
        ...base,
        pfxBase64: '%%%invalido%%%',
        companyIds: ['40000000-0000-4000-8000-000000000001'],
      }),
    ).rejects.toThrow('Base64 válido');
  });
});
