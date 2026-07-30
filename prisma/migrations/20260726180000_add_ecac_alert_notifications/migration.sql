CREATE TYPE "EcacNotificationChannel" AS ENUM ('IN_APP', 'EMAIL');
CREATE TYPE "EcacNotificationEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "ecac_alert_notification_preferences" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "channel" "EcacNotificationChannel" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minimum_severity" "EcacFindingSeverity" NOT NULL DEFAULT 'WARNING',
  "include_resolved" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ecac_alert_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecac_alert_notification_preferences_tenant_id_user_id_channel_key"
  ON "ecac_alert_notification_preferences"("tenant_id", "user_id", "channel");
CREATE INDEX "ecac_alert_notification_preferences_tenant_id_user_id_idx"
  ON "ecac_alert_notification_preferences"("tenant_id", "user_id");

ALTER TABLE "ecac_alert_notification_preferences"
  ADD CONSTRAINT "ecac_alert_notification_preferences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_alert_notification_preferences"
  ADD CONSTRAINT "ecac_alert_notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ecac_alert_notification_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "alert_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "query_type" "EcacQueryType" NOT NULL,
  "channel" "EcacNotificationChannel" NOT NULL,
  "status" "EcacNotificationEventStatus" NOT NULL DEFAULT 'PENDING',
  "change_type" "EcacAlertChangeType" NOT NULL,
  "severity" "EcacFindingSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "dedupe_key" CHAR(64) NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "delivered_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "failure_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ecac_alert_notification_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ecac_alert_notification_events_tenant_id_dedupe_key_key"
  ON "ecac_alert_notification_events"("tenant_id", "dedupe_key");
CREATE UNIQUE INDEX "ecac_alert_notification_events_tenant_id_id_key"
  ON "ecac_alert_notification_events"("tenant_id", "id");
CREATE INDEX "ecac_alert_notification_events_tenant_id_user_id_status_scheduled_at_idx"
  ON "ecac_alert_notification_events"("tenant_id", "user_id", "status", "scheduled_at");
CREATE INDEX "ecac_alert_notification_events_tenant_id_alert_id_idx"
  ON "ecac_alert_notification_events"("tenant_id", "alert_id");

ALTER TABLE "ecac_alert_notification_events"
  ADD CONSTRAINT "ecac_alert_notification_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_alert_notification_events"
  ADD CONSTRAINT "ecac_alert_notification_events_tenant_id_alert_id_fkey"
  FOREIGN KEY ("tenant_id", "alert_id") REFERENCES "ecac_alerts"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecac_alert_notification_events"
  ADD CONSTRAINT "ecac_alert_notification_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
