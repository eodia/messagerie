CREATE TABLE "chat"."agent_identity" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identity_issuer_subject_pk" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "chat"."invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "chat"."session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."agent_identity" ADD CONSTRAINT "agent_identity_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."invitation" ADD CONSTRAINT "invitation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."invitation" ADD CONSTRAINT "invitation_created_by_agent_id_fk" FOREIGN KEY ("created_by") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."session" ADD CONSTRAINT "session_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_agent_idx" ON "chat"."session" USING btree ("agent_id");