ALTER TABLE "ecac_sync_jobs"
    ADD COLUMN "lock_token" UUID;

CREATE INDEX "ecac_sync_jobs_status_next_attempt_at_idx"
    ON "ecac_sync_jobs"("status", "next_attempt_at");
