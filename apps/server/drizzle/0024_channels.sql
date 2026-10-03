CREATE TYPE "chat"."channel" AS ENUM('web', 'sms', 'rcs');--> statement-breakpoint
CREATE TYPE "chat"."outbound_channel" AS ENUM('email', 'push', 'sms');--> statement-breakpoint
CREATE TYPE "chat"."outbound_status" AS ENUM('pending', 'in_flight', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "chat"."outbound" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "chat"."outbound_channel" NOT NULL,
	"purpose" text NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"notification_id" uuid,
	"agent_id" uuid,
	"status" "chat"."outbound_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "chat"."sms_number" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"provider" text,
	"account_sid" text,
	"token_env" text,
	"messaging_service_sid" text,
	"site_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "email_alerts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "channel" "chat"."channel" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "sms_number_id" text;--> statement-breakpoint
ALTER TABLE "chat"."site" ADD COLUMN "email_replies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."outbound" ADD CONSTRAINT "outbound_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."outbound" ADD CONSTRAINT "outbound_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."outbound" ADD CONSTRAINT "outbound_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "chat"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."outbound" ADD CONSTRAINT "outbound_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."push_subscription" ADD CONSTRAINT "push_subscription_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."sms_number" ADD CONSTRAINT "sms_number_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "chat"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_due_idx" ON "chat"."outbound" USING btree ("next_attempt_at") WHERE "chat"."outbound"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbound_message_idx" ON "chat"."outbound" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "outbound_conversation_idx" ON "chat"."outbound" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_provider_idx" ON "chat"."outbound" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_alert_pending_key" ON "chat"."outbound" USING btree ("notification_id","channel") WHERE "chat"."outbound"."status" in ('pending', 'in_flight');--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_alert_email_key" ON "chat"."outbound" USING btree ("notification_id") WHERE "chat"."outbound"."channel" = 'email';--> statement-breakpoint
CREATE INDEX "push_subscription_agent_idx" ON "chat"."push_subscription" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "contact_phone_idx" ON "chat"."contact" USING btree ("site_id","phone");