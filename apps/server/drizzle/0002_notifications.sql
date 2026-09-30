CREATE TYPE "chat"."alert_kind" AS ENUM('visitor_message', 'handoff', 'assigned');--> statement-breakpoint
CREATE TABLE "chat"."notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" "chat"."alert_kind" NOT NULL,
	"by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."notification" ADD CONSTRAINT "notification_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."notification" ADD CONSTRAINT "notification_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."notification" ADD CONSTRAINT "notification_by_agent_id_agent_id_fk" FOREIGN KEY ("by_agent_id") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_agent_idx" ON "chat"."notification" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_unread_key" ON "chat"."notification" USING btree ("agent_id","conversation_id","kind") WHERE "chat"."notification"."read_at" is null;