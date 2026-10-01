ALTER TYPE "chat"."alert_kind" ADD VALUE 'transferred';--> statement-breakpoint
ALTER TABLE "chat"."contact" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "chat"."contact" ADD COLUMN "data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "inbox_id" text;--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_box_idx" ON "chat"."conversation" USING btree ("inbox_id","status");