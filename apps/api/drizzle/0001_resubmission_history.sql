ALTER TABLE "submissions" DROP CONSTRAINT "submissions_token_id_unique";--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
-- DEFERRABLE INITIALLY DEFERRED so the FK is only checked at COMMIT time.
-- /submit runs UPDATE (set superseded_by = newId) BEFORE INSERT (new row
-- with id = newId) in a single transaction; with a non-deferred FK, the
-- UPDATE fails because the target id doesn't exist yet. Deferring the
-- check to COMMIT lets both rows land and satisfy each other.
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "submissions"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_active_token_id_uniq" ON "submissions" USING btree ("token_id") WHERE "submissions"."superseded_at" IS NULL;