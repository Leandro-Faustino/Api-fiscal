ALTER TYPE "EcacNotificationEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "ecac_alert_notification_events"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "processing_started_at" TIMESTAMP(3),
  ADD COLUMN "last_attempted_at" TIMESTAMP(3);

CREATE INDEX "ecac_alert_notification_events_status_scheduled_at_idx"
  ON "ecac_alert_notification_events"("status", "scheduled_at");

CREATE INDEX "ecac_alert_notification_events_status_processing_started_at_idx"
  ON "ecac_alert_notification_events"("status", "processing_started_at");
