import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/api_fiscal',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  MFA_ENCRYPTION_KEY: 'test-mfa-key-with-at-least-32-characters',
  CREDENTIAL_VAULT_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('configuração do ambiente', () => {
  it('impede exposição de tokens de recuperação em produção', () => {
    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        EXPOSE_RECOVERY_TOKENS: 'true',
      }),
    ).toThrow('Tokens de recuperação não podem ser expostos em produção.');
  });

  it('exige uma chave Base64 de 32 bytes para o cofre', () => {
    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        CREDENTIAL_VAULT_MASTER_KEY: Buffer.alloc(31).toString('base64'),
      }),
    ).toThrow('A chave do cofre deve conter exatamente 32 bytes codificados em Base64.');
  });

  it('valida as versões anteriores do keyring do cofre', () => {
    const valid = loadEnv({
      ...requiredEnvironment,
      CREDENTIAL_VAULT_KEY_VERSION: '2',
      CREDENTIAL_VAULT_PREVIOUS_KEYS: JSON.stringify({
        1: Buffer.alloc(32, 6).toString('base64'),
      }),
    });
    expect(valid.CREDENTIAL_VAULT_PREVIOUS_KEYS).toContain('"1"');

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        CREDENTIAL_VAULT_KEY_VERSION: '2',
        CREDENTIAL_VAULT_PREVIOUS_KEYS: JSON.stringify({
          2: Buffer.alloc(32, 6).toString('base64'),
        }),
      }),
    ).toThrow('As chaves anteriores do cofre devem ser um objeto JSON');
  });

  it('restringe os endpoints SERPRO em produção', () => {
    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        SERPRO_AUTH_URL: 'https://example.com/authenticate',
      }),
    ).toThrow('A URL de autenticação SERPRO de produção é inválida.');

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        SERPRO_API_BASE_URL:
          'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/nao-oficial',
      }),
    ).toThrow('A URL da API SERPRO de produção é inválida.');
  });
});
