import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().max(65_535).default(3333),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default('api-fiscal'),
    JWT_AUDIENCE: z.string().default('api-fiscal-web'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1_000).default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    ENABLE_SWAGGER_UI: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    MFA_ENCRYPTION_KEY: z.string().min(32),
    CREDENTIAL_VAULT_MASTER_KEY: z.string().min(1),
    CREDENTIAL_VAULT_KEY_VERSION: z.coerce.number().int().positive().default(1),
    CREDENTIAL_VAULT_PREVIOUS_KEYS: z.string().default('{}'),
    MFA_ISSUER: z.string().min(2).max(80).default('API Fiscal'),
    MFA_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().max(30).default(5),
    MFA_MAXIMUM_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(15),
    EXPOSE_RECOVERY_TOKENS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    INVITATION_TTL_HOURS: z.coerce.number().int().positive().max(168).default(72),
    COMPANY_REGISTRY_BASE_URL: z.url().default('https://brasilapi.com.br/api/cnpj/v1'),
    COMPANY_REGISTRY_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    SERPRO_AUTH_URL: z
      .url()
      .default('https://autenticacao.sapi.serpro.gov.br/authenticate'),
    SERPRO_API_BASE_URL: z
      .url()
      .default('https://gateway.apiserpro.serpro.gov.br/integra-contador/v1'),
    SERPRO_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(15_000),
    SERPRO_TRIAL_BEARER: z.string().trim().default(''),
    ECAC_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(30_000),
    ECAC_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    ECAC_MONITORING_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25),
    ECAC_WORKER_LOCK_TTL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(3_600_000)
      .default(600_000),
    ECAC_NOTIFICATION_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(30_000),
    ECAC_NOTIFICATION_WORKER_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25),
    ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(3_600_000)
      .default(600_000),
    ECAC_NOTIFICATION_RETRY_DELAY_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(300_000),
    ECAC_EMAIL_PROVIDER: z.enum(['disabled', 'http']).default('disabled'),
    ECAC_EMAIL_HTTP_URL: z.string().trim().default(''),
    ECAC_EMAIL_HTTP_AUTHORIZATION: z.string().trim().default(''),
    ECAC_EMAIL_FROM: z.string().trim().default(''),
    ECAC_EMAIL_SUBJECT_PREFIX: z.string().trim().max(80).default('[API Fiscal]'),
    ECAC_EMAIL_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(10_000),
  })
  .superRefine((env, context) => {
    const encodedVaultKey = env.CREDENTIAL_VAULT_MASTER_KEY.trim();
    const vaultKey = Buffer.from(encodedVaultKey, 'base64');
    if (
      vaultKey.length !== 32 ||
      vaultKey.toString('base64') !== encodedVaultKey
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CREDENTIAL_VAULT_MASTER_KEY'],
        message: 'A chave do cofre deve conter exatamente 32 bytes codificados em Base64.',
      });
    }

    try {
      const previousKeys: unknown = JSON.parse(env.CREDENTIAL_VAULT_PREVIOUS_KEYS);
      if (
        typeof previousKeys !== 'object' ||
        previousKeys === null ||
        Array.isArray(previousKeys)
      ) {
        throw new Error();
      }

      for (const [versionText, encodedKeyValue] of Object.entries(previousKeys)) {
        const version = Number(versionText);
        if (
          !Number.isSafeInteger(version) ||
          version <= 0 ||
          version === env.CREDENTIAL_VAULT_KEY_VERSION ||
          typeof encodedKeyValue !== 'string'
        ) {
          throw new Error();
        }

        const encodedKey = encodedKeyValue.trim();
        const key = Buffer.from(encodedKey, 'base64');
        if (key.length !== 32 || key.toString('base64') !== encodedKey) {
          throw new Error();
        }
      }
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['CREDENTIAL_VAULT_PREVIOUS_KEYS'],
        message:
          'As chaves anteriores do cofre devem ser um objeto JSON de versões positivas para chaves Base64 de 32 bytes.',
      });
    }

    if (env.NODE_ENV === 'production' && env.EXPOSE_RECOVERY_TOKENS) {
      context.addIssue({
        code: 'custom',
        path: ['EXPOSE_RECOVERY_TOKENS'],
        message: 'Tokens de recuperação não podem ser expostos em produção.',
      });
    }

    const minimumWorkerLockTtlMs = env.SERPRO_TIMEOUT_MS * 4 + 30_000;
    if (env.ECAC_WORKER_LOCK_TTL_MS < minimumWorkerLockTtlMs) {
      context.addIssue({
        code: 'custom',
        path: ['ECAC_WORKER_LOCK_TTL_MS'],
        message:
          'O TTL do lock do worker e-CAC deve cobrir autenticação, renovação e consultas ao SERPRO.',
      });
    }

    if (
      env.ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS <=
      env.ECAC_NOTIFICATION_RETRY_DELAY_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS'],
        message:
          'O TTL de processamento das notificações e-CAC deve ser maior que o atraso de retry.',
      });
    }

    if (env.ECAC_EMAIL_PROVIDER === 'http') {
      if (!env.ECAC_EMAIL_HTTP_URL) {
        context.addIssue({
          code: 'custom',
          path: ['ECAC_EMAIL_HTTP_URL'],
          message: 'A URL HTTP das notificações e-CAC é obrigatória.',
        });
      }
      if (!env.ECAC_EMAIL_FROM) {
        context.addIssue({
          code: 'custom',
          path: ['ECAC_EMAIL_FROM'],
          message: 'O remetente das notificações e-CAC é obrigatório.',
        });
      }
      if (env.ECAC_EMAIL_HTTP_URL) {
        try {
          const emailUrl = new URL(env.ECAC_EMAIL_HTTP_URL);
          if (
            emailUrl.protocol !== 'https:' &&
            !(env.NODE_ENV !== 'production' && emailUrl.hostname === 'localhost')
          ) {
            throw new Error();
          }
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['ECAC_EMAIL_HTTP_URL'],
            message:
              'A URL HTTP das notificações e-CAC deve ser HTTPS, exceto localhost fora de produção.',
          });
        }
      }
      if (env.NODE_ENV === 'production' && !env.ECAC_EMAIL_HTTP_AUTHORIZATION) {
        context.addIssue({
          code: 'custom',
          path: ['ECAC_EMAIL_HTTP_AUTHORIZATION'],
          message:
            'A autorização HTTP das notificações e-CAC é obrigatória em produção.',
        });
      }
    }

    if (env.SERPRO_TRIAL_BEARER) {
      if (env.NODE_ENV === 'production') {
        context.addIssue({
          code: 'custom',
          path: ['SERPRO_TRIAL_BEARER'],
          message:
            'O Bearer de demonstração do SERPRO não pode ser usado em produção.',
        });
      }
      if (!env.SERPRO_API_BASE_URL.includes('/integra-contador-trial/')) {
        context.addIssue({
          code: 'custom',
          path: ['SERPRO_TRIAL_BEARER'],
          message:
            'O Bearer de demonstração exige a URL de trial do Integra Contador.',
        });
      }
    }

    if (env.NODE_ENV === 'production') {
      const authUrl = new URL(env.SERPRO_AUTH_URL);
      const apiUrl = new URL(env.SERPRO_API_BASE_URL);
      if (
        authUrl.protocol !== 'https:' ||
        authUrl.hostname !== 'autenticacao.sapi.serpro.gov.br' ||
        authUrl.port !== '' ||
        authUrl.username !== '' ||
        authUrl.password !== '' ||
        authUrl.pathname !== '/authenticate' ||
        authUrl.search !== '' ||
        authUrl.hash !== ''
      ) {
        context.addIssue({
          code: 'custom',
          path: ['SERPRO_AUTH_URL'],
          message: 'A URL de autenticação SERPRO de produção é inválida.',
        });
      }
      if (
        apiUrl.protocol !== 'https:' ||
        apiUrl.hostname !== 'gateway.apiserpro.serpro.gov.br' ||
        apiUrl.port !== '' ||
        apiUrl.username !== '' ||
        apiUrl.password !== '' ||
        !['/integra-contador/v1', '/integra-contador/v1/'].includes(
          apiUrl.pathname,
        ) ||
        apiUrl.search !== '' ||
        apiUrl.hash !== ''
      ) {
        context.addIssue({
          code: 'custom',
          path: ['SERPRO_API_BASE_URL'],
          message: 'A URL da API SERPRO de produção é inválida.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
