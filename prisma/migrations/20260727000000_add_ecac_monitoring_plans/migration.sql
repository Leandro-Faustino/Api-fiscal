CREATE TYPE "EcacMonitoringPlanStatus" AS ENUM ('ACTIVE', 'PAUSED');

CREATE TABLE "ecac_monitoring_plans" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "power_of_attorney_id" UUID NOT NULL,
  "query_type" "EcacQueryType" NOT NULL,
  "status" "EcacMonitoringPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "interval_minutes" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_run_at" TIMESTAMP(3) NOT NULL,
  "last_run_at" TIMESTAMP(3),
  "last_batch_id" UUID,
  "last_failure_at" TIMESTAMP(3),
  "last_failure_code" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "triggered_runs" INTEGER NOT NULL DEFAULT 0,
  "locked_at" TIMESTAMP(3),
  "lock_token" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ecac_monitoring_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecac_monitoring_plans_tenant_id_company_id_query_type_key"
  ON "ecac_monitoring_plans"("tenant_id", "company_id", "query_type");
CREATE UNIQUE INDEX "ecac_monitoring_plans_tenant_id_id_key"
  ON "ecac_monitoring_plans"("tenant_id", "id");
CREATE INDEX "ecac_monitoring_plans_status_next_run_at_idx"
  ON "ecac_monitoring_plans"("status", "next_run_at");
CREATE INDEX "ecac_monitoring_plans_tenant_id_status_next_run_at_idx"
  ON "ecac_monitoring_plans"("tenant_id", "status", "next_run_at");
CREATE INDEX "ecac_monitoring_plans_locked_at_idx"
  ON "ecac_monitoring_plans"("locked_at");

ALTER TABLE "ecac_monitoring_plans"
  ADD CONSTRAINT "ecac_monitoring_plans_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecac_monitoring_plans"
  ADD CONSTRAINT "ecac_monitoring_plans_tenant_id_company_id_fkey"
  FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ecac_monitoring_plans"
  ADD CONSTRAINT "ecac_monitoring_plans_power_of_attorney_fkey"
  FOREIGN KEY ("tenant_id", "company_id", "power_of_attorney_id")
  REFERENCES "powers_of_attorney"("tenant_id", "company_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ecac_monitoring_plans"
  ADD CONSTRAINT "ecac_monitoring_plans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
