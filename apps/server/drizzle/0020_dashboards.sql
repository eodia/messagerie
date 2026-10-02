CREATE TABLE "chat"."dashboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."dashboard" ADD CONSTRAINT "dashboard_created_by_agent_id_fk" FOREIGN KEY ("created_by") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;