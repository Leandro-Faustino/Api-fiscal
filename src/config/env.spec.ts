import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/api_fiscal',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  MFA_ENCRYPTION_KEY: 'test-mfa-key-with-at-least-32-characters',
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
});
