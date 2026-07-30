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
import type { CertificateInspector } from '../modules/credentials/application/ports/certificate-inspector.js';
import type { CredentialCipher } from '../modules/credentials/application/ports/credential-cipher.js';
import type { DigitalCertificateRepository } from '../modules/credentials/application/ports/digital-certificate-repository.js';
import { GetDigitalCertificateUseCase } from '../modules/credentials/application/use-cases/get-digital-certificate.js';
import { ListDigitalCertificatesUseCase } from '../modules/credentials/application/use-cases/list-digital-certificates.js';
import { RevokeDigitalCertificateUseCase } from '../modules/credentials/application/use-cases/revoke-digital-certificate.js';
import { UploadA1CertificateUseCase } from '../modules/credentials/application/use-cases/upload-a1-certificate.js';
import { RotateCredentialKeysUseCase } from '../modules/credentials/application/use-cases/rotate-credential-keys.js';
import { PrismaDigitalCertificateRepository } from '../modules/credentials/infra/repositories/prisma-digital-certificate-repository.js';
import { AesGcmCredentialCipher } from '../modules/credentials/infra/security/aes-gcm-credential-cipher.js';
import { Pkcs12CertificateInspector } from '../modules/credentials/infra/security/pkcs12-certificate-inspector.js';
import type { CredentialAuthorityRepository } from '../modules/credentials/application/ports/credential-authority-repository.js';
import { AssignCompanyResponsibleUseCase } from '../modules/credentials/application/use-cases/assign-company-responsible.js';
import {
  DeactivateCompanyResponsibleUseCase,
  ListCompanyResponsiblesUseCase,
} from '../modules/credentials/application/use-cases/manage-company-responsibles.js';
import { CreatePowerOfAttorneyUseCase } from '../modules/credentials/application/use-cases/create-power-of-attorney.js';
import {
  ListPowersOfAttorneyUseCase,
  RevokePowerOfAttorneyUseCase,
} from '../modules/credentials/application/use-cases/manage-powers-of-attorney.js';
import {
  AcknowledgeCredentialAlertUseCase,
  ListCredentialAlertsUseCase,
  ScanCredentialExpirationAlertsUseCase,
} from '../modules/credentials/application/use-cases/manage-credential-alerts.js';
import { PrismaCredentialAuthorityRepository } from '../modules/credentials/infra/repositories/prisma-credential-authority-repository.js';
import type { EcacGateway } from '../modules/ecac/application/ports/ecac-gateway.js';
import type { EcacRadarRepository } from '../modules/ecac/application/ports/ecac-radar-repository.js';
import type { EcacAlertNotificationRepository } from '../modules/ecac/application/ports/ecac-alert-notification-repository.js';
import { ProcessEcacJobsUseCase } from '../modules/ecac/application/use-cases/process-ecac-jobs.js';
import {
  AcknowledgeEcacAlertUseCase,
  GetEcacSyncBatchUseCase,
  ListEcacAlertsUseCase,
  ListEcacFindingsUseCase,
  ListEcacSyncBatchesUseCase,
} from '../modules/ecac/application/use-cases/read-ecac-radar.js';
import {
  ListEcacNotificationEventsUseCase,
  ListEcacNotificationPreferencesUseCase,
  MarkEcacNotificationEventDeliveredUseCase,
  UpdateEcacNotificationPreferenceUseCase,
} from '../modules/ecac/application/use-cases/manage-ecac-alert-notifications.js';
import { RequestEcacSyncUseCase } from '../modules/ecac/application/use-cases/request-ecac-sync.js';
import { PrismaEcacAlertNotificationRepository } from '../modules/ecac/infra/repositories/prisma-ecac-alert-notification-repository.js';
import { PrismaEcacRadarRepository } from '../modules/ecac/infra/repositories/prisma-ecac-radar-repository.js';
import type { SerproConnectionRepository } from '../modules/ecac/application/ports/serpro-connection-repository.js';
import type { SerproHttpTransport } from '../modules/ecac/application/ports/serpro-http-transport.js';
import {
  ConfigureSerproConnectionUseCase,
  GetSerproConnectionUseCase,
} from '../modules/ecac/application/use-cases/configure-serpro-connection.js';
import { RotateSerproConnectionKeyUseCase } from '../modules/ecac/application/use-cases/rotate-serpro-connection-key.js';
import { PrismaSerproConnectionRepository } from '../modules/ecac/infra/repositories/prisma-serpro-connection-repository.js';
import { NativeSerproHttpTransport } from '../modules/ecac/infra/http/native-serpro-http-transport.js';
import { SerproIntegraContadorGateway } from '../modules/ecac/infra/gateways/serpro-integra-contador-gateway.js';
import type { EcacSitfisProcessRepository } from '../modules/ecac/application/ports/ecac-sitfis-process-repository.js';
import { PrismaEcacSitfisProcessRepository } from '../modules/ecac/infra/repositories/prisma-ecac-sitfis-process-repository.js';
import { RotateSitfisProtocolKeysUseCase } from '../modules/ecac/application/use-cases/rotate-sitfis-protocol-keys.js';

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
  credentialVaultMasterKey: string;
  credentialVaultKeyVersion: number;
  credentialVaultPreviousKeys: string;
  certificateInspector: CertificateInspector;
  credentialCipher: CredentialCipher;
  digitalCertificateRepository: DigitalCertificateRepository;
  uploadA1CertificateUseCase: UploadA1CertificateUseCase;
  getDigitalCertificateUseCase: GetDigitalCertificateUseCase;
  listDigitalCertificatesUseCase: ListDigitalCertificatesUseCase;
  revokeDigitalCertificateUseCase: RevokeDigitalCertificateUseCase;
  rotateCredentialKeysUseCase: RotateCredentialKeysUseCase;
  credentialAuthorityRepository: CredentialAuthorityRepository;
  assignCompanyResponsibleUseCase: AssignCompanyResponsibleUseCase;
  listCompanyResponsiblesUseCase: ListCompanyResponsiblesUseCase;
  deactivateCompanyResponsibleUseCase: DeactivateCompanyResponsibleUseCase;
  createPowerOfAttorneyUseCase: CreatePowerOfAttorneyUseCase;
  listPowersOfAttorneyUseCase: ListPowersOfAttorneyUseCase;
  revokePowerOfAttorneyUseCase: RevokePowerOfAttorneyUseCase;
  scanCredentialExpirationAlertsUseCase: ScanCredentialExpirationAlertsUseCase;
  listCredentialAlertsUseCase: ListCredentialAlertsUseCase;
  acknowledgeCredentialAlertUseCase: AcknowledgeCredentialAlertUseCase;
  ecacGateway: EcacGateway;
  ecacSitfisProcessRepository: EcacSitfisProcessRepository;
  rotateSitfisProtocolKeysUseCase: RotateSitfisProtocolKeysUseCase;
  serproConnectionRepository: SerproConnectionRepository;
  serproHttpTransport: SerproHttpTransport;
  serproAuthUrl: string;
  serproApiBaseUrl: string;
  serproTimeoutMs: number;
  configureSerproConnectionUseCase: ConfigureSerproConnectionUseCase;
  getSerproConnectionUseCase: GetSerproConnectionUseCase;
  rotateSerproConnectionKeyUseCase: RotateSerproConnectionKeyUseCase;
  ecacRadarRepository: EcacRadarRepository;
  requestEcacSyncUseCase: RequestEcacSyncUseCase;
  getEcacSyncBatchUseCase: GetEcacSyncBatchUseCase;
  listEcacSyncBatchesUseCase: ListEcacSyncBatchesUseCase;
  processEcacJobsUseCase: ProcessEcacJobsUseCase;
  listEcacFindingsUseCase: ListEcacFindingsUseCase;
  listEcacAlertsUseCase: ListEcacAlertsUseCase;
  acknowledgeEcacAlertUseCase: AcknowledgeEcacAlertUseCase;
  ecacAlertNotificationRepository: EcacAlertNotificationRepository;
  listEcacNotificationPreferencesUseCase: ListEcacNotificationPreferencesUseCase;
  updateEcacNotificationPreferenceUseCase: UpdateEcacNotificationPreferenceUseCase;
  listEcacNotificationEventsUseCase: ListEcacNotificationEventsUseCase;
  markEcacNotificationEventDeliveredUseCase: MarkEcacNotificationEventDeliveredUseCase;
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
    credentialVaultMasterKey: asValue(env.CREDENTIAL_VAULT_MASTER_KEY),
    credentialVaultKeyVersion: asValue(env.CREDENTIAL_VAULT_KEY_VERSION),
    credentialVaultPreviousKeys: asValue(env.CREDENTIAL_VAULT_PREVIOUS_KEYS),
    certificateInspector: asClass(Pkcs12CertificateInspector).singleton(),
    credentialCipher: asClass(AesGcmCredentialCipher).singleton(),
    digitalCertificateRepository: asClass(PrismaDigitalCertificateRepository).singleton(),
    uploadA1CertificateUseCase: asClass(UploadA1CertificateUseCase).singleton(),
    getDigitalCertificateUseCase: asClass(GetDigitalCertificateUseCase).singleton(),
    listDigitalCertificatesUseCase: asClass(ListDigitalCertificatesUseCase).singleton(),
    revokeDigitalCertificateUseCase: asClass(RevokeDigitalCertificateUseCase).singleton(),
    rotateCredentialKeysUseCase: asClass(RotateCredentialKeysUseCase).singleton(),
    credentialAuthorityRepository: asClass(
      PrismaCredentialAuthorityRepository,
    ).singleton(),
    assignCompanyResponsibleUseCase: asClass(
      AssignCompanyResponsibleUseCase,
    ).singleton(),
    listCompanyResponsiblesUseCase: asClass(
      ListCompanyResponsiblesUseCase,
    ).singleton(),
    deactivateCompanyResponsibleUseCase: asClass(
      DeactivateCompanyResponsibleUseCase,
    ).singleton(),
    createPowerOfAttorneyUseCase: asClass(CreatePowerOfAttorneyUseCase).singleton(),
    listPowersOfAttorneyUseCase: asClass(ListPowersOfAttorneyUseCase).singleton(),
    revokePowerOfAttorneyUseCase: asClass(RevokePowerOfAttorneyUseCase).singleton(),
    scanCredentialExpirationAlertsUseCase: asClass(
      ScanCredentialExpirationAlertsUseCase,
    ).singleton(),
    listCredentialAlertsUseCase: asClass(ListCredentialAlertsUseCase).singleton(),
    acknowledgeCredentialAlertUseCase: asClass(
      AcknowledgeCredentialAlertUseCase,
    ).singleton(),
    ecacSitfisProcessRepository: asClass(
      PrismaEcacSitfisProcessRepository,
    ).singleton(),
    rotateSitfisProtocolKeysUseCase: asClass(
      RotateSitfisProtocolKeysUseCase,
    ).singleton(),
    serproConnectionRepository: asClass(
      PrismaSerproConnectionRepository,
    ).singleton(),
    serproHttpTransport: asClass(NativeSerproHttpTransport).singleton(),
    serproAuthUrl: asValue(env.SERPRO_AUTH_URL),
    serproApiBaseUrl: asValue(env.SERPRO_API_BASE_URL),
    serproTimeoutMs: asValue(env.SERPRO_TIMEOUT_MS),
    configureSerproConnectionUseCase: asClass(
      ConfigureSerproConnectionUseCase,
    ).singleton(),
    getSerproConnectionUseCase: asClass(
      GetSerproConnectionUseCase,
    ).singleton(),
    rotateSerproConnectionKeyUseCase: asClass(
      RotateSerproConnectionKeyUseCase,
    ).singleton(),
    ecacGateway: asClass(SerproIntegraContadorGateway).singleton(),
    ecacRadarRepository: asClass(PrismaEcacRadarRepository).singleton(),
    ecacAlertNotificationRepository: asClass(
      PrismaEcacAlertNotificationRepository,
    ).singleton(),
    requestEcacSyncUseCase: asClass(RequestEcacSyncUseCase).singleton(),
    getEcacSyncBatchUseCase: asClass(GetEcacSyncBatchUseCase).singleton(),
    listEcacSyncBatchesUseCase: asClass(ListEcacSyncBatchesUseCase).singleton(),
    processEcacJobsUseCase: asClass(ProcessEcacJobsUseCase).singleton(),
    listEcacFindingsUseCase: asClass(ListEcacFindingsUseCase).singleton(),
    listEcacAlertsUseCase: asClass(ListEcacAlertsUseCase).singleton(),
    acknowledgeEcacAlertUseCase: asClass(
      AcknowledgeEcacAlertUseCase,
    ).singleton(),
    listEcacNotificationPreferencesUseCase: asClass(
      ListEcacNotificationPreferencesUseCase,
    ).singleton(),
    updateEcacNotificationPreferenceUseCase: asClass(
      UpdateEcacNotificationPreferenceUseCase,
    ).singleton(),
    listEcacNotificationEventsUseCase: asClass(
      ListEcacNotificationEventsUseCase,
    ).singleton(),
    markEcacNotificationEventDeliveredUseCase: asClass(
      MarkEcacNotificationEventDeliveredUseCase,
    ).singleton(),
  });

  return container;
}
