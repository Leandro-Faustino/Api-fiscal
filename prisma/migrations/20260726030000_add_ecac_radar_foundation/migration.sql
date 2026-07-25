CREATE TYPE "EcacQueryType" AS ENUM ('TAX_STATUS', 'DEBTS', 'MAILBOX');
CREATE TYPE "EcacSyncBatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED');
CREATE TYPE "EcacSyncJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED');
CREATE TYPE "EcacFindingSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "ecac_sync_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_key" TEXT NOT NULL,
    "target_hash" CHAR(64) NOT NULL,
    "query_type" "EcacQueryType" NOT NULL,
    "status" "EcacSyncBatchStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_id" UUID NOT NULL,
    "total_jobs" INTEGER NOT NULL,
    "succeeded_jobs" INTEGER NOT NULL DEFAULT 0,
    "failed_jobs" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecac_sync_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ecac_sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "power_of_attorney_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "query_type" "EcacQueryType" NOT NULL,
    "status" "EcacSyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "protocol" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "response_hash" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecac_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ecac_findings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "EcacFindingSeverity" NOT NULL,
    "source_reference" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecac_findings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecac_sync_batches_tenant_id_request_key_key"
    ON "ecac_sync_batches"("tenant_id", "request_key");
CREATE UNIQUE INDEX "ecac_sync_batches_tenant_id_id_key"
    ON "ecac_sync_batches"("tenant_id", "id");
CREATE INDEX "ecac_sync_batches_tenant_id_status_created_at_idx"
    ON "ecac_sync_batches"("tenant_id", "status", "created_at");

CREATE UNIQUE INDEX "ecac_sync_jobs_batch_id_company_id_key"
    ON "ecac_sync_jobs"("batch_id", "company_id");
CREATE UNIQUE INDEX "ecac_sync_jobs_tenant_id_id_key"
    ON "ecac_sync_jobs"("tenant_id", "id");
CREATE INDEX "ecac_sync_jobs_tenant_id_status_next_attempt_at_idx"
    ON "ecac_sync_jobs"("tenant_id", "status", "next_attempt_at");
CREATE INDEX "ecac_sync_jobs_tenant_id_company_id_created_at_idx"
    ON "ecac_sync_jobs"("tenant_id", "company_id", "created_at");
CREATE INDEX "ecac_sync_jobs_locked_at_idx" ON "ecac_sync_jobs"("locked_at");

CREATE UNIQUE INDEX "powers_of_attorney_tenant_id_company_id_id_key"
    ON "powers_of_attorney"("tenant_id", "company_id", "id");

CREATE UNIQUE INDEX "ecac_findings_job_id_code_source_reference_key"
    ON "ecac_findings"("job_id", "code", "source_reference");
CREATE INDEX "ecac_findings_tenant_id_company_id_severity_observed_at_idx"
    ON "ecac_findings"("tenant_id", "company_id", "severity", "observed_at");
CREATE INDEX "ecac_findings_tenant_id_category_observed_at_idx"
    ON "ecac_findings"("tenant_id", "category", "observed_at");

ALTER TABLE "ecac_sync_batches"
    ADD CONSTRAINT "ecac_sync_batches_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_sync_batches"
    ADD CONSTRAINT "ecac_sync_batches_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ecac_sync_jobs"
    ADD CONSTRAINT "ecac_sync_jobs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_sync_jobs"
    ADD CONSTRAINT "ecac_sync_jobs_tenant_id_batch_id_fkey"
    FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "ecac_sync_batches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_sync_jobs"
    ADD CONSTRAINT "ecac_sync_jobs_tenant_id_company_id_fkey"
    FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_sync_jobs"
    ADD CONSTRAINT "ecac_sync_jobs_tenant_id_company_id_power_of_attorney_id_fkey"
    FOREIGN KEY ("tenant_id", "company_id", "power_of_attorney_id") REFERENCES "powers_of_attorney"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecac_sync_jobs"
    ADD CONSTRAINT "ecac_sync_jobs_tenant_id_certificate_id_fkey"
    FOREIGN KEY ("tenant_id", "certificate_id") REFERENCES "digital_certificates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ecac_findings"
    ADD CONSTRAINT "ecac_findings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_findings"
    ADD CONSTRAINT "ecac_findings_tenant_id_company_id_fkey"
    FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_findings"
    ADD CONSTRAINT "ecac_findings_tenant_id_job_id_fkey"
    FOREIGN KEY ("tenant_id", "job_id") REFERENCES "ecac_sync_jobs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
