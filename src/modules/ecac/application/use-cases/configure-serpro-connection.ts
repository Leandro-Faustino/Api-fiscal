import { randomUUID } from 'node:crypto';
import { Cnpj } from '../../../control/companies/domain/cnpj.js';
import { NotFoundError, ValidationError } from '../../../../shared/domain/app-error.js';
import type { CredentialCipher } from '../../../credentials/application/ports/credential-cipher.js';
import type { SerproConnectionRepository } from '../ports/serpro-connection-repository.js';
import type { SerproConnection } from '../../domain/serpro-connection.js';

interface Dependencies {
  serproConnectionRepository: SerproConnectionRepository;
  credentialCipher: CredentialCipher;
}

export interface ConfigureSerproConnectionCommand {
  tenantId: string;
  actorId: string;
  certificateId: string;
  contractorCnpj: string;
  requesterCnpj: string;
  consumerKey: string;
  consumerSecret: string;
}

export class ConfigureSerproConnectionUseCase {
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
    command: ConfigureSerproConnectionCommand,
  ): Promise<SerproConnection> {
    const contractorCnpj = Cnpj.create(command.contractorCnpj).value;
    const requesterCnpj = Cnpj.create(command.requesterCnpj).value;
    const consumerKey = command.consumerKey.trim();
    const consumerSecret = command.consumerSecret.trim();

    if (consumerKey.length < 8 || consumerKey.length > 256) {
      throw new ValidationError(
        'A Consumer Key deve ter entre 8 e 256 caracteres.',
      );
    }
    if (consumerSecret.length < 8 || consumerSecret.length > 512) {
      throw new ValidationError(
        'A Consumer Secret deve ter entre 8 e 512 caracteres.',
      );
    }

    const consumerKeyBuffer = Buffer.from(consumerKey, 'utf8');
    const consumerSecretBuffer = Buffer.from(consumerSecret, 'utf8');
    try {
      const encryptedConsumerKey = this.cipher.seal(
        consumerKeyBuffer,
        `tenant:${command.tenantId}:serpro:consumer-key`,
      );
      const encryptedConsumerSecret = this.cipher.seal(
        consumerSecretBuffer,
        `tenant:${command.tenantId}:serpro:consumer-secret`,
      );

      return this.repository.configureWithAudit({
        id: randomUUID(),
        tenantId: command.tenantId,
        certificateId: command.certificateId,
        contractorCnpj,
        requesterCnpj,
        encryptedConsumerKey: encryptedConsumerKey.ciphertext,
        encryptedConsumerSecret: encryptedConsumerSecret.ciphertext,
        keyVersion: this.cipher.getActiveKeyVersion(),
        actorId: command.actorId,
        configuredAt: new Date(),
      });
    } finally {
      consumerKeyBuffer.fill(0);
      consumerSecretBuffer.fill(0);
    }
  }
}

export class GetSerproConnectionUseCase {
  private readonly repository: SerproConnectionRepository;

  public constructor({ serproConnectionRepository }: Dependencies) {
    this.repository = serproConnectionRepository;
  }

  public async execute(tenantId: string): Promise<SerproConnection> {
    const connection = await this.repository.find(tenantId);
    if (!connection) {
      throw new NotFoundError(
        'Conexão com o SERPRO não configurada.',
        'SERPRO_CONNECTION_NOT_FOUND',
      );
    }
    return connection;
  }
}
