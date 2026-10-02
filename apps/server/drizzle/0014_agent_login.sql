ALTER TABLE "chat"."agent" DROP CONSTRAINT "agent_basedb_user_id_unique";--> statement-breakpoint
ALTER TABLE "chat"."agent" ALTER COLUMN "login" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."agent" DROP COLUMN "basedb_user_id";--> statement-breakpoint
ALTER TABLE "chat"."agent" DROP COLUMN "synced_at";