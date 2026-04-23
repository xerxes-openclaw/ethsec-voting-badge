ALTER TABLE "submissions" DROP CONSTRAINT "submissions_token_id_unique";--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_active_token_id_uniq" ON "submissions" USING btree ("token_id") WHERE "submissions"."superseded_at" IS NULL;