ALTER TYPE "chat"."ai_run_kind" ADD VALUE 'rephrase';--> statement-breakpoint
ALTER TABLE "chat"."kb_chunk" ADD COLUMN "digest" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."kb_chunk" ADD COLUMN "site_ids" text[] DEFAULT '{}'::text[] NOT NULL;