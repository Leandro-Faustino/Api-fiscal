-- CreateEnum
CREATE TYPE "CompanyResponsibleRole" AS ENUM ('PRIMARY', 'SUPPORT');

-- CreateEnum
CREATE TYPE "CompanyResponsibleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PowerOfAttorneyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "CredentialAlertKind" AS ENUM ('EXPIRING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CredentialAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED');

-- Composite ownership keys keep relationships inside one tenant.
CREATE UNIQUE INDEX "memberships_tenant_id_id_key"
ON "memberships"("tenant_id", "id");

-- CreateTable
CREATE TABLE "company_responsibles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role" "CompanyResponsibleRole" NOT NULL,
    "status" "CompanyResponsibleStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_responsibles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "powers_of_attorney" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "responsible_id" UUID NOT NULL,
    "certificate_id" UUID,
    "label" TEXT NOT NULL,
    "external_reference" TEXT,
    "services" TEXT[],
    "status" "PowerOfAttorneyStatus" NOT NULL DEFAULT 'ACTIVE',
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "powers_of_attorney_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "powers_of_attorney_validity_check"
      CHECK ("valid_until" > "valid_from")
);

-- CreateTable
CREATE TABLE "credential_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "certificate_id" UUID,
    "power_of_attorney_id" UUID,
    "kind" "CredentialAlertKind" NOT NULL,
    "status" "CredentialAlertStatus" NOT NULL DEFAULT 'OPEN',
    "threshold_days" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credential_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credential_alerts_single_source_check"
      CHECK (
        ("certificate_id" IS NOT NULL AND "power_of_attorney_id" IS NULL)
        OR
        ("certificate_id" IS NULL AND "power_of_attorney_id" IS NOT NULL)
      ),
    CONSTRAINT "credential_alerts_threshold_check"
      CHECK (
        ("kind" = 'EXPIRED' AND "threshold_days" = 0)
        OR
        ("kind" = 'EXPIRING' AND "threshold_days" IN (1, 7, 15, 30))
      )
);

-- CreateIndex
CREATE UNIQUE INDEX "company_responsibles_tenant_company_membership_key"
ON "company_responsibles"("tenant_id", "company_id", "membership_id");

CREATE UNIQUE INDEX "company_responsibles_tenant_company_id_key"
ON "company_responsibles"("tenant_id", "company_id", "id");

CREATE INDEX "company_responsibles_tenant_status_idx"
ON "company_responsibles"("tenant_id", "status");

CREATE INDEX "company_responsibles_membership_status_idx"
ON "company_responsibles"("membership_id", "status");

CREATE UNIQUE INDEX "powers_of_attorney_tenant_external_reference_key"
ON "powers_of_attorney"("tenant_id", "external_reference");

CREATE UNIQUE INDEX "powers_of_attorney_tenant_id_key"
ON "powers_of_attorney"("tenant_id", "id");

CREATE INDEX "powers_of_attorney_tenant_status_valid_until_idx"
ON "powers_of_attorney"("tenant_id", "status", "valid_until");

CREATE INDEX "powers_of_attorney_company_status_idx"
ON "powers_of_attorney"("company_id", "status");

CREATE INDEX "powers_of_attorney_responsible_status_idx"
ON "powers_of_attorney"("responsible_id", "status");

CREATE INDEX "powers_of_attorney_certificate_id_idx"
ON "powers_of_attorney"("certificate_id");

CREATE UNIQUE INDEX "credential_alerts_certificate_dedupe_key"
ON "credential_alerts"(
  "tenant_id", "certificate_id", "kind", "threshold_days", "due_at"
);

CREATE UNIQUE INDEX "credential_alerts_power_dedupe_key"
ON "credential_alerts"(
  "tenant_id", "power_of_attorney_id", "kind", "threshold_days", "due_at"
);

CREATE INDEX "credential_alerts_tenant_status_due_at_idx"
ON "credential_alerts"("tenant_id", "status", "due_at");

CREATE INDEX "credential_alerts_certificate_id_idx"
ON "credential_alerts"("certificate_id");

CREATE INDEX "credential_alerts_power_of_attorney_id_idx"
ON "credential_alerts"("power_of_attorney_id");

-- AddForeignKey
ALTER TABLE "company_responsibles"
ADD CONSTRAINT "company_responsibles_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_responsibles"
ADD CONSTRAINT "company_responsibles_tenant_company_fkey"
FOREIGN KEY ("tenant_id", "company_id")
REFERENCES "companies"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_responsibles"
ADD CONSTRAINT "company_responsibles_tenant_membership_fkey"
FOREIGN KEY ("tenant_id", "membership_id")
REFERENCES "memberships"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_responsibles"
ADD CONSTRAINT "company_responsibles_assigned_by_id_fkey"
FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "powers_of_attorney"
ADD CONSTRAINT "powers_of_attorney_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "powers_of_attorney"
ADD CONSTRAINT "powers_of_attorney_tenant_company_fkey"
FOREIGN KEY ("tenant_id", "company_id")
REFERENCES "companies"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "powers_of_attorney"
ADD CONSTRAINT "powers_of_attorney_responsible_fkey"
FOREIGN KEY ("tenant_id", "company_id", "responsible_id")
REFERENCES "company_responsibles"("tenant_id", "company_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "powers_of_attorney"
ADD CONSTRAINT "powers_of_attorney_tenant_certificate_fkey"
FOREIGN KEY ("tenant_id", "certificate_id")
REFERENCES "digital_certificates"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "powers_of_attorney"
ADD CONSTRAINT "powers_of_attorney_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credential_alerts"
ADD CONSTRAINT "credential_alerts_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credential_alerts"
ADD CONSTRAINT "credential_alerts_tenant_certificate_fkey"
FOREIGN KEY ("tenant_id", "certificate_id")
REFERENCES "digital_certificates"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credential_alerts"
ADD CONSTRAINT "credential_alerts_tenant_power_fkey"
FOREIGN KEY ("tenant_id", "power_of_attorney_id")
REFERENCES "powers_of_attorney"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credential_alerts"
ADD CONSTRAINT "credential_alerts_acknowledged_by_id_fkey"
FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
