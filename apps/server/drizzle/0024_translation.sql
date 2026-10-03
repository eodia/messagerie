ALTER TYPE "chat"."ai_run_kind" ADD VALUE 'translation';--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "chat"."site" ADD COLUMN "translate" boolean DEFAULT true NOT NULL;