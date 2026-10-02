ALTER TYPE "chat"."alert_kind" ADD VALUE 'woke';--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "snoozed_until" timestamp with time zone;