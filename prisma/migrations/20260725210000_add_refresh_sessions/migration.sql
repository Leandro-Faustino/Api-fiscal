CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_sessions_token_hash_key"
ON "refresh_sessions"("token_hash");

CREATE INDEX "refresh_sessions_family_id_idx"
ON "refresh_sessions"("family_id");

CREATE INDEX "refresh_sessions_membership_id_revoked_at_idx"
ON "refresh_sessions"("membership_id", "revoked_at");

CREATE INDEX "refresh_sessions_expires_at_idx"
ON "refresh_sessions"("expires_at");

ALTER TABLE "refresh_sessions"
ADD CONSTRAINT "refresh_sessions_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
