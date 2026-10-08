ALTER TABLE "outbox_jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_dedupe_key_unique" ON "outbox_jobs" USING btree ("dedupe_key");