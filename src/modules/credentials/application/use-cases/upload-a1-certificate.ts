import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../../../shared/domain/app-error.js';
import type { CertificateInspector } from '../ports/certificate-inspector.js';
import type { CredentialCipher } from '../ports/credential-cipher.js';
import type { DigitalCertificateRepository } from '../ports/digital-certificate-repository.js';
import {
  withCertificateLifecycle,
  type DigitalCertificateView,
} from '../../domain/digital-certificate.js';

interface Dependencies {
  certificateInspector: CertificateInspector;
  credentialCipher: CredentialCipher;
  digitalCertificateRepository: DigitalCertificateRepository;
}

export interface UploadA1CertificateInput {
  tenantId: string;
  actorId: string;
  label: string;
  pfxBase64: string;
  password: string;
  companyIds: string[];
}

const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;

function decodeBase64Certificate(value: string): Buffer {
  const normalized = value.replace(/\s/gu, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)
  ) {
    throw new ValidationError('O certificado deve ser enviado em Base64 válido.');
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0 || decoded.length > MAX_CERTIFICATE_BYTES) {
    throw new ValidationError('O certificado A1 deve ter no máximo 2 MB.');
  }

  return decoded;
}

export class UploadA1CertificateUseCase {
  private readonly certificateInspector: CertificateInspector;
  private readonly credentialCipher: CredentialCipher;
  private readonly repository: DigitalCertificateRepository;

  public constructor({
    certificateInspector,
    credentialCipher,
    digitalCertificateRepository,
  }: Dependencies) {
    this.certificateInspector = certificateInspector;
    this.credentialCipher = credentialCipher;
    this.repository = digitalCertificateRepository;
  }

  public async execute(input: UploadA1CertificateInput): Promise<DigitalCertificateView> {
    const label = input.label.trim();
    if (label.length < 2 || label.length > 120) {
      throw new ValidationError('O nome do certificado deve ter entre 2 e 120 caracteres.');
    }

    const companyIds = [...new Set(input.companyIds)];
    if (
      companyIds.length === 0 ||
      companyIds.length > 300 ||
      companyIds.length !== input.companyIds.length
    ) {
      throw new ValidationError(
        'Informe de 1 a 300 empresas distintas para o escopo do certificado.',
      );
    }

    const bundle = decodeBase64Certificate(input.pfxBase64);
    const certificateId = randomUUID();

    try {
      const inspection = this.certificateInspector.inspect(bundle, input.password);
      const contextPrefix = `certificate:${input.tenantId}:${certificateId}`;
      const sealedBundle = this.credentialCipher.seal(bundle, `${contextPrefix}:bundle`);
      const passwordBuffer = Buffer.from(input.password, 'utf8');

      try {
        const sealedPassword = this.credentialCipher.seal(
          passwordBuffer,
          `${contextPrefix}:password`,
        );
        if (sealedBundle.keyVersion !== sealedPassword.keyVersion) {
          throw new Error('A chave do cofre mudou durante a operação.');
        }

        const certificate = await this.repository.createWithAudit({
          id: certificateId,
          tenantId: input.tenantId,
          actorId: input.actorId,
          label,
          encryptedBundle: sealedBundle.ciphertext,
          encryptedPassword: sealedPassword.ciphertext,
          keyVersion: sealedBundle.keyVersion,
          inspection,
          companyIds,
        });

        return withCertificateLifecycle(certificate);
      } finally {
        passwordBuffer.fill(0);
      }
    } finally {
      bundle.fill(0);
    }
  }
}
