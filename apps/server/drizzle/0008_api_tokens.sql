CREATE TABLE "chat"."api_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"access" text NOT NULL,
	"surfaces" text[] NOT NULL,
	"inbox_ids" text[],
	"agent_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "chat"."api_token" ADD CONSTRAINT "api_token_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."api_token" ADD CONSTRAINT "api_token_created_by_agent_id_fk" FOREIGN KEY ("created_by") REFERENCES "chat"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."api_token" ADD CONSTRAINT "api_token_revoked_by_agent_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;