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
    registerTenantUseCase: asClass(RegisterTenantUseCase).singleton(),
    loginUseCase: asClass(LoginUseCase).singleton(),
    createInvitationUseCase: asClass(CreateInvitationUseCase).singleton(),
    acceptInvitationUseCase: asClass(AcceptInvitationUseCase).singleton(),
    listMembersUseCase: asClass(ListMembersUseCase).singleton(),
  });

  return container;
}
