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

  it('valida os limites globais e o TTL do worker e-CAC', () => {
    const valid = loadEnv({
      ...requiredEnvironment,
      ECAC_WORKER_POLL_INTERVAL_MS: '5000',
      ECAC_WORKER_BATCH_SIZE: '50',
      ECAC_WORKER_LOCK_TTL_MS: '120000',
      SERPRO_TIMEOUT_MS: '15000',
    });
    expect(valid.ECAC_WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(valid.ECAC_WORKER_BATCH_SIZE).toBe(50);
    expect(valid.ECAC_WORKER_LOCK_TTL_MS).toBe(120000);

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        ECAC_WORKER_LOCK_TTL_MS: '60000',
        SERPRO_TIMEOUT_MS: '60000',
      }),
    ).toThrow(
      'O TTL do lock do worker e-CAC deve cobrir autenticação, renovação e consultas ao SERPRO.',
    );
  });

  it('valida os limites globais do worker de notificações e-CAC', () => {
    const valid = loadEnv({
      ...requiredEnvironment,
      ECAC_NOTIFICATION_WORKER_POLL_INTERVAL_MS: '5000',
      ECAC_NOTIFICATION_WORKER_BATCH_SIZE: '50',
      ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS: '600000',
      ECAC_NOTIFICATION_RETRY_DELAY_MS: '300000',
    });
    expect(valid.ECAC_NOTIFICATION_WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(valid.ECAC_NOTIFICATION_WORKER_BATCH_SIZE).toBe(50);
    expect(valid.ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS).toBe(600000);
    expect(valid.ECAC_NOTIFICATION_RETRY_DELAY_MS).toBe(300000);

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS: '60000',
        ECAC_NOTIFICATION_RETRY_DELAY_MS: '60000',
      }),
    ).toThrow(
      'O TTL de processamento das notificações e-CAC deve ser maior que o atraso de retry.',
    );
  });

  it('mantém e-mail e-CAC desabilitado por padrão e valida HTTP quando habilitado', () => {
    const disabled = loadEnv(requiredEnvironment);
    expect(disabled.ECAC_EMAIL_PROVIDER).toBe('disabled');

    const http = loadEnv({
      ...requiredEnvironment,
      ECAC_EMAIL_PROVIDER: 'http',
      ECAC_EMAIL_HTTP_URL: 'https://email.example.com/send',
      ECAC_EMAIL_HTTP_AUTHORIZATION: 'Bearer secret',
      ECAC_EMAIL_FROM: 'API Fiscal <alertas@example.com>',
      ECAC_EMAIL_SUBJECT_PREFIX: '[Control]',
      ECAC_EMAIL_TIMEOUT_MS: '5000',
    });
    expect(http.ECAC_EMAIL_PROVIDER).toBe('http');
    expect(http.ECAC_EMAIL_HTTP_URL).toBe('https://email.example.com/send');
    expect(http.ECAC_EMAIL_TIMEOUT_MS).toBe(5000);

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        ECAC_EMAIL_PROVIDER: 'http',
        ECAC_EMAIL_FROM: 'API Fiscal <alertas@example.com>',
      }),
    ).toThrow('A URL HTTP das notificações e-CAC é obrigatória.');

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        ECAC_EMAIL_PROVIDER: 'http',
        ECAC_EMAIL_HTTP_URL: 'https://email.example.com/send',
      }),
    ).toThrow('O remetente das notificações e-CAC é obrigatório.');

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        ECAC_EMAIL_PROVIDER: 'http',
        ECAC_EMAIL_HTTP_URL: 'http://email.example.com/send',
        ECAC_EMAIL_FROM: 'API Fiscal <alertas@example.com>',
      }),
    ).toThrow(
      'A URL HTTP das notificações e-CAC deve ser HTTPS, exceto localhost fora de produção.',
    );

    expect(() =>
      loadEnv({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        ECAC_EMAIL_PROVIDER: 'http',
        ECAC_EMAIL_HTTP_URL: 'https://email.example.com/send',
        ECAC_EMAIL_FROM: 'API Fiscal <alertas@example.com>',
      }),
    ).toThrow(
      'A autorização HTTP das notificações e-CAC é obrigatória em produção.',
    );
  });
});
