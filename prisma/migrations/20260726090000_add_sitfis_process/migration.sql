CREATE TYPE "EcacSitfisStatus" AS ENUM (
  'AWAITING_PROTOCOL',
  'AWAITING_REPORT',
  'COMPLETED'
);

CREATE TABLE "ecac_sitfis_processes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "status" "EcacSitfisStatus" NOT NULL DEFAULT 'AWAITING_PROTOCOL',
  "encrypted_protocol" TEXT,
  "protocol_key_version" INTEGER,
  "protocol_hash" CHAR(64),
  "next_attempt_at" TIMESTAMP(3),
  "provider_status" INTEGER,
  "report_hash" CHAR(64),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ecac_sitfis_processes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecac_sitfis_protocol_consistency_check" CHECK (
    (
      "status" = 'AWAITING_PROTOCOL'
      AND "encrypted_protocol" IS NULL
      AND "protocol_key_version" IS NULL
      AND "protocol_hash" IS NULL
    )
    OR (
      "status" = 'AWAITING_REPORT'
      AND "encrypted_protocol" IS NOT NULL
      AND "protocol_key_version" IS NOT NULL
      AND "protocol_hash" IS NOT NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "encrypted_protocol" IS NULL
      AND "protocol_key_version" IS NULL
      AND "protocol_hash" IS NOT NULL
      AND "report_hash" IS NOT NULL
      AND "completed_at" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "ecac_sitfis_processes_job_id_key"
  ON "ecac_sitfis_processes"("job_id");
CREATE UNIQUE INDEX "ecac_sitfis_processes_tenant_id_id_key"
  ON "ecac_sitfis_processes"("tenant_id", "id");
CREATE UNIQUE INDEX "ecac_sitfis_processes_tenant_id_job_id_key"
  ON "ecac_sitfis_processes"("tenant_id", "job_id");
CREATE INDEX "ecac_sitfis_processes_tenant_id_status_next_attempt_at_idx"
  ON "ecac_sitfis_processes"("tenant_id", "status", "next_attempt_at");
CREATE INDEX "ecac_sitfis_processes_tenant_id_company_id_created_at_idx"
  ON "ecac_sitfis_processes"("tenant_id", "company_id", "created_at");

ALTER TABLE "ecac_sitfis_processes"
  ADD CONSTRAINT "ecac_sitfis_processes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecac_sitfis_processes"
  ADD CONSTRAINT "ecac_sitfis_processes_tenant_id_job_id_fkey"
  FOREIGN KEY ("tenant_id", "job_id")
  REFERENCES "ecac_sync_jobs"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecac_sitfis_processes"
  ADD CONSTRAINT "ecac_sitfis_processes_tenant_id_company_id_fkey"
  FOREIGN KEY ("tenant_id", "company_id")
  REFERENCES "companies"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
