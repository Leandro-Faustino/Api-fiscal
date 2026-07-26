CREATE TYPE "EcacAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "EcacAlertChangeType" AS ENUM ('NEW', 'CHANGED', 'REOPENED', 'RESOLVED');

ALTER TABLE "ecac_sync_jobs"
  ADD COLUMN "observation_order" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "ecac_sync_jobs_observation_order_key"
  ON "ecac_sync_jobs"("observation_order");

CREATE TABLE "ecac_alerts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "latest_job_id" UUID NOT NULL,
  "query_type" "EcacQueryType" NOT NULL,
  "finding_key" CHAR(64) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "code" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "severity" "EcacFindingSeverity" NOT NULL,
  "status" "EcacAlertStatus" NOT NULL DEFAULT 'OPEN',
  "last_change_type" "EcacAlertChangeType" NOT NULL,
  "first_observed_at" TIMESTAMP(3) NOT NULL,
  "last_observed_at" TIMESTAMP(3) NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_id" UUID,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ecac_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecac_alerts_tenant_id_company_id_query_type_finding_key_key"
  ON "ecac_alerts"("tenant_id", "company_id", "query_type", "finding_key");
CREATE UNIQUE INDEX "ecac_alerts_tenant_id_id_key"
  ON "ecac_alerts"("tenant_id", "id");
CREATE INDEX "ecac_alerts_tenant_id_status_severity_updated_at_idx"
  ON "ecac_alerts"("tenant_id", "status", "severity", "updated_at");
CREATE INDEX "ecac_alerts_tenant_id_company_id_query_type_status_idx"
  ON "ecac_alerts"("tenant_id", "company_id", "query_type", "status");
CREATE INDEX "ecac_alerts_latest_job_id_idx" ON "ecac_alerts"("latest_job_id");
CREATE INDEX "ecac_alerts_acknowledged_by_id_idx"
  ON "ecac_alerts"("acknowledged_by_id");

ALTER TABLE "ecac_alerts"
  ADD CONSTRAINT "ecac_alerts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_alerts"
  ADD CONSTRAINT "ecac_alerts_tenant_id_company_id_fkey"
  FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_alerts"
  ADD CONSTRAINT "ecac_alerts_tenant_id_latest_job_id_fkey"
  FOREIGN KEY ("tenant_id", "latest_job_id") REFERENCES "ecac_sync_jobs"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecac_alerts"
  ADD CONSTRAINT "ecac_alerts_acknowledged_by_id_fkey"
  FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ecac_observation_cursors" (
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "query_type" "EcacQueryType" NOT NULL,
  "latest_job_id" UUID NOT NULL,
  "latest_observation_order" BIGINT NOT NULL,
  "last_observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ecac_observation_cursors_pkey"
    PRIMARY KEY ("tenant_id", "company_id", "query_type")
);

CREATE INDEX "ecac_observation_cursors_latest_job_id_idx"
  ON "ecac_observation_cursors"("latest_job_id");

ALTER TABLE "ecac_observation_cursors"
  ADD CONSTRAINT "ecac_observation_cursors_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_observation_cursors"
  ADD CONSTRAINT "ecac_observation_cursors_tenant_id_company_id_fkey"
  FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_observation_cursors"
  ADD CONSTRAINT "ecac_observation_cursors_tenant_id_latest_job_id_fkey"
  FOREIGN KEY ("tenant_id", "latest_job_id") REFERENCES "ecac_sync_jobs"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
