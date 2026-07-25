-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('CONTROL', 'FLOW', 'ESSENTIAL');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CompanyDataSource" AS ENUM ('BRASIL_API', 'MANUAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'CONTROL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "registration_status" "CompanyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "opening_date" DATE,
    "primary_cnae" TEXT,
    "primary_cnae_description" TEXT,
    "municipality" TEXT,
    "state" CHAR(2),
    "data_source" "CompanyDataSource" NOT NULL,
    "registry_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_parameter_versions" (
    "id" UUID NOT NULL,
    "parameter_type" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "source_url" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_parameter_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "companies_tenant_id_idx" ON "companies"("tenant_id");

-- CreateIndex
CREATE INDEX "companies_registration_status_idx" ON "companies"("registration_status");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_cnpj_key" ON "companies"("tenant_id", "cnpj");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_occurred_at_idx" ON "audit_logs"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "tax_parameter_versions_parameter_type_jurisdiction_valid_fr_idx" ON "tax_parameter_versions"("parameter_type", "jurisdiction", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_parameter_versions_parameter_type_jurisdiction_valid_fr_key" ON "tax_parameter_versions"("parameter_type", "jurisdiction", "valid_from");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
