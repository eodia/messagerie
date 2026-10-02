CREATE TABLE "chat"."page_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"confirm" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_action_site_name_key" UNIQUE("site_id","name")
);
--> statement-breakpoint
CREATE TABLE "chat"."page_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirm" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"claimed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "page" jsonb;--> statement-breakpoint
ALTER TABLE "chat"."page_call" ADD CONSTRAINT "page_call_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."page_call" ADD CONSTRAINT "page_call_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_call_conversation_idx" ON "chat"."page_call" USING btree ("conversation_id","created_at");