CREATE TYPE "SerproConnectionStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "serpro_connections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "certificate_id" UUID NOT NULL,
  "contractor_cnpj" CHAR(14) NOT NULL,
  "requester_cnpj" CHAR(14) NOT NULL,
  "encrypted_consumer_key" TEXT NOT NULL,
  "encrypted_consumer_secret" TEXT NOT NULL,
  "key_version" INTEGER NOT NULL,
  "status" "SerproConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "configured_by_id" UUID NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "serpro_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "serpro_connections_tenant_id_key"
  ON "serpro_connections"("tenant_id");
CREATE UNIQUE INDEX "serpro_connections_tenant_id_id_key"
  ON "serpro_connections"("tenant_id", "id");
CREATE INDEX "serpro_connections_tenant_id_status_idx"
  ON "serpro_connections"("tenant_id", "status");
CREATE INDEX "serpro_connections_certificate_id_idx"
  ON "serpro_connections"("certificate_id");

ALTER TABLE "serpro_connections"
  ADD CONSTRAINT "serpro_connections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "serpro_connections"
  ADD CONSTRAINT "serpro_connections_tenant_id_certificate_id_fkey"
  FOREIGN KEY ("tenant_id", "certificate_id")
  REFERENCES "digital_certificates"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "serpro_connections"
  ADD CONSTRAINT "serpro_connections_configured_by_id_fkey"
  FOREIGN KEY ("configured_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
