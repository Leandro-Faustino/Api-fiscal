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

export interface Cradle {
  prismaClient: PrismaClient;
  companyRegistryBaseUrl: string;
  companyRegistryTimeoutMs: number;
  companyRepository: CompanyRepository;
  companyRegistryGateway: CompanyRegistryGateway;
  registerCompanyUseCase: RegisterCompanyUseCase;
  getCompanyUseCase: GetCompanyUseCase;
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
  });

  return container;
}
