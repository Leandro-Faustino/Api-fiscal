import {
  asClass,
  asValue,
  createContainer,
  InjectionMode,
  type AwilixContainer,
} from 'awilix';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';
import type { CompanyRegistryGateway } from '../modules/control/companies/application/ports/company-registry-gateway.js';
import type { CompanyRepository } from '../modules/control/companies/application/ports/company-repository.js';
import { GetCompanyUseCase } from '../modules/control/companies/application/use-cases/get-company.js';
import { RegisterCompanyUseCase } from '../modules/control/companies/application/use-cases/register-company.js';
import { BrasilApiCompanyRegistryGateway } from '../modules/control/companies/infra/gateways/brasil-api-company-registry-gateway.js';
import { PrismaCompanyRepository } from '../modules/control/companies/infra/repositories/prisma-company-repository.js';
import type { AccessRepository } from '../modules/access/application/ports/access-repository.js';
import type { PasswordHasher } from '../modules/access/application/ports/password-hasher.js';
import { RegisterTenantUseCase } from '../modules/access/application/use-cases/register-tenant.js';
import { LoginUseCase } from '../modules/access/application/use-cases/login.js';
import { CreateInvitationUseCase } from '../modules/access/application/use-cases/create-invitation.js';
import { AcceptInvitationUseCase } from '../modules/access/application/use-cases/accept-invitation.js';
import { ListMembersUseCase } from '../modules/access/application/use-cases/list-members.js';
import { PrismaAccessRepository } from '../modules/access/infra/repositories/prisma-access-repository.js';
import { ScryptPasswordHasher } from '../modules/access/infra/security/scrypt-password-hasher.js';
import type { RefreshSessionRepository } from '../modules/access/application/ports/refresh-session-repository.js';
import { PrismaRefreshSessionRepository } from '../modules/access/infra/repositories/prisma-refresh-session-repository.js';
import { CreateRefreshSessionUseCase } from '../modules/access/application/use-cases/create-refresh-session.js';
import { RotateRefreshSessionUseCase } from '../modules/access/application/use-cases/rotate-refresh-session.js';
import { RevokeRefreshSessionUseCase } from '../modules/access/application/use-cases/revoke-refresh-session.js';
import type { SecurityRepository } from '../modules/access/application/ports/security-repository.js';
import type { MfaService } from '../modules/access/application/ports/mfa-service.js';
import { PrismaSecurityRepository } from '../modules/access/infra/repositories/prisma-security-repository.js';
import { TotpMfaService } from '../modules/access/infra/security/totp-mfa-service.js';
import { StartMfaChallengeUseCase } from '../modules/access/application/use-cases/start-mfa-challenge.js';
import { VerifyMfaChallengeUseCase } from '../modules/access/application/use-cases/verify-mfa-challenge.js';
import { RequestPasswordResetUseCase } from '../modules/access/application/use-cases/request-password-reset.js';
import { ResetPasswordUseCase } from '../modules/access/application/use-cases/reset-password.js';

export interface Cradle {
  prismaClient: PrismaClient;
  companyRegistryBaseUrl: string;
  companyRegistryTimeoutMs: number;
  companyRepository: CompanyRepository;
  companyRegistryGateway: CompanyRegistryGateway;
  registerCompanyUseCase: RegisterCompanyUseCase;
  getCompanyUseCase: GetCompanyUseCase;
  accessRepository: AccessRepository;
  passwordHasher: PasswordHasher;
  invitationTtlHours: number;
  jwtExpiresIn: string;
  refreshSessionRepository: RefreshSessionRepository;
  refreshTokenTtlDays: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  securityRepository: SecurityRepository;
  mfaService: MfaService;
  mfaEncryptionKey: string;
  mfaIssuer: string;
  mfaChallengeTtlMinutes: number;
  mfaMaximumAttempts: number;
  passwordResetTtlMinutes: number;
  exposeRecoveryTokens: boolean;
  startMfaChallengeUseCase: StartMfaChallengeUseCase;
  verifyMfaChallengeUseCase: VerifyMfaChallengeUseCase;
  requestPasswordResetUseCase: RequestPasswordResetUseCase;
  resetPasswordUseCase: ResetPasswordUseCase;
  createRefreshSessionUseCase: CreateRefreshSessionUseCase;
  rotateRefreshSessionUseCase: RotateRefreshSessionUseCase;
  revokeRefreshSessionUseCase: RevokeRefreshSessionUseCase;
  registerTenantUseCase: RegisterTenantUseCase;
  loginUseCase: LoginUseCase;
  createInvitationUseCase: CreateInvitationUseCase;
  acceptInvitationUseCase: AcceptInvitationUseCase;
  listMembersUseCase: ListMembersUseCase;
}

export function createApplicationContainer(env: Env, prismaClient: PrismaClient): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    prismaClient: asValue(prismaClient),
    companyRegistryBaseUrl: asValue(env.COMPANY_REGISTRY_BASE_URL),
    companyRegistryTimeoutMs: asValue(env.COMPANY_REGISTRY_TIMEOUT_MS),
    companyRepository: asClass(PrismaCompanyRepository).singleton(),
    companyRegistryGateway: asClass(BrasilApiCompanyRegistryGateway).singleton(),
    registerCompanyUseCase: asClass(RegisterCompanyUseCase).singleton(),
    getCompanyUseCase: asClass(GetCompanyUseCase).singleton(),
    accessRepository: asClass(PrismaAccessRepository).singleton(),
    passwordHasher: asClass(ScryptPasswordHasher).singleton(),
    invitationTtlHours: asValue(env.INVITATION_TTL_HOURS),
    jwtExpiresIn: asValue(env.JWT_EXPIRES_IN),
    refreshSessionRepository: asClass(PrismaRefreshSessionRepository).singleton(),
    refreshTokenTtlDays: asValue(env.REFRESH_TOKEN_TTL_DAYS),
    authRateLimitMax: asValue(env.AUTH_RATE_LIMIT_MAX),
    authRateLimitWindowMs: asValue(env.AUTH_RATE_LIMIT_WINDOW_MS),
    securityRepository: asClass(PrismaSecurityRepository).singleton(),
    mfaService: asClass(TotpMfaService).singleton(),
    mfaEncryptionKey: asValue(env.MFA_ENCRYPTION_KEY),
    mfaIssuer: asValue(env.MFA_ISSUER),
    mfaChallengeTtlMinutes: asValue(env.MFA_CHALLENGE_TTL_MINUTES),
    mfaMaximumAttempts: asValue(env.MFA_MAXIMUM_ATTEMPTS),
    passwordResetTtlMinutes: asValue(env.PASSWORD_RESET_TTL_MINUTES),
    exposeRecoveryTokens: asValue(env.EXPOSE_RECOVERY_TOKENS),
    startMfaChallengeUseCase: asClass(StartMfaChallengeUseCase).singleton(),
    verifyMfaChallengeUseCase: asClass(VerifyMfaChallengeUseCase).singleton(),
    requestPasswordResetUseCase: asClass(RequestPasswordResetUseCase).singleton(),
    resetPasswordUseCase: asClass(ResetPasswordUseCase).singleton(),
    createRefreshSessionUseCase: asClass(CreateRefreshSessionUseCase).singleton(),
    rotateRefreshSessionUseCase: asClass(RotateRefreshSessionUseCase).singleton(),
    revokeRefreshSessionUseCase: asClass(RevokeRefreshSessionUseCase).singleton(),
    registerTenantUseCase: asClass(RegisterTenantUseCase).singleton(),
    loginUseCase: asClass(LoginUseCase).singleton(),
    createInvitationUseCase: asClass(CreateInvitationUseCase).singleton(),
    acceptInvitationUseCase: asClass(AcceptInvitationUseCase).singleton(),
    listMembersUseCase: asClass(ListMembersUseCase).singleton(),
  });

  return container;
}
