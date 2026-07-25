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
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && env.EXPOSE_RECOVERY_TOKENS) {
      context.addIssue({
        code: 'custom',
        path: ['EXPOSE_RECOVERY_TOKENS'],
        message: 'Tokens de recuperação não podem ser expostos em produção.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
