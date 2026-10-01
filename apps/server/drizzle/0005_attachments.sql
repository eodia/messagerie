ALTER TYPE "chat"."ai_run_kind" ADD VALUE 'attachment';--> statement-breakpoint
ALTER TABLE "chat"."attachment" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."attachment" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
CREATE INDEX "attachment_message_idx" ON "chat"."attachment" USING btree ("message_id");