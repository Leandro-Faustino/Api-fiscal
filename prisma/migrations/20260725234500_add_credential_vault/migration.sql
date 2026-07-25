-- CreateEnum
CREATE TYPE "DigitalCertificateKind" AS ENUM ('A1');

-- CreateEnum
CREATE TYPE "DigitalCertificateStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- The composite keys enforce tenant ownership in certificate scopes.
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies"("tenant_id", "id");

-- CreateTable
CREATE TABLE "digital_certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "DigitalCertificateKind" NOT NULL DEFAULT 'A1',
    "status" "DigitalCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "encrypted_bundle" TEXT NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "fingerprint_sha256" CHAR(64) NOT NULL,
    "serial_number" TEXT NOT NULL,
    "subject_common_name" TEXT NOT NULL,
    "issuer_common_name" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_company_scopes" (
    "tenant_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_company_scopes_pkey" PRIMARY KEY ("certificate_id", "company_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "digital_certificates_tenant_id_fingerprint_sha256_key"
ON "digital_certificates"("tenant_id", "fingerprint_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "digital_certificates_tenant_id_id_key"
ON "digital_certificates"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "digital_certificates_tenant_id_status_valid_until_idx"
ON "digital_certificates"("tenant_id", "status", "valid_until");

-- CreateIndex
CREATE INDEX "digital_certificates_uploaded_by_id_idx"
ON "digital_certificates"("uploaded_by_id");

-- CreateIndex
CREATE INDEX "certificate_company_scopes_tenant_id_company_id_idx"
ON "certificate_company_scopes"("tenant_id", "company_id");

-- AddForeignKey
ALTER TABLE "digital_certificates"
ADD CONSTRAINT "digital_certificates_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_certificates"
ADD CONSTRAINT "digital_certificates_uploaded_by_id_fkey"
FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_company_scopes"
ADD CONSTRAINT "certificate_company_scopes_tenant_id_certificate_id_fkey"
FOREIGN KEY ("tenant_id", "certificate_id")
REFERENCES "digital_certificates"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_company_scopes"
ADD CONSTRAINT "certificate_company_scopes_tenant_id_company_id_fkey"
FOREIGN KEY ("tenant_id", "company_id")
REFERENCES "companies"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
