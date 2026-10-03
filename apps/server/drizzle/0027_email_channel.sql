ALTER TYPE "chat"."channel" ADD VALUE 'email';--> statement-breakpoint
CREATE TABLE "chat"."email_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"site_id" uuid,
	"imap_server" text,
	"smtp_server" text,
	"login" text,
	"password_env" text,
	"receive" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD COLUMN "email_address_id" text;--> statement-breakpoint
ALTER TABLE "chat"."email_address" ADD CONSTRAINT "email_address_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "chat"."site"("id") ON DELETE set null ON UPDATE no action;