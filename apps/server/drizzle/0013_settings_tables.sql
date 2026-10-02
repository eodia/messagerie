CREATE TABLE "chat"."agent_team" (
	"agent_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "agent_team_agent_id_team_id_pk" PRIMARY KEY("agent_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."ai_tool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text,
	"target" text,
	"method" text,
	"token_env" text,
	"headers" text,
	"parameters" text,
	"for_ai" boolean DEFAULT false NOT NULL,
	"for_copilot" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."article_site" (
	"article_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "article_site_article_id_site_id_pk" PRIMARY KEY("article_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."article" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"status" text,
	"author_id" uuid,
	"reviewed_on" date,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."canned_reply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"shortcut" text,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."canned_reply_team" (
	"canned_reply_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "canned_reply_team_canned_reply_id_team_id_pk" PRIMARY KEY("canned_reply_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"message" text,
	"site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."guardrail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"action" text,
	"message" text,
	"active" boolean DEFAULT true NOT NULL,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."inbox_team" (
	"inbox_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "inbox_team_inbox_id_team_id_pk" PRIMARY KEY("inbox_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"image" text,
	"active" boolean DEFAULT true NOT NULL,
	"default_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."mcp_server" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"description" text,
	"token_env" text,
	"headers" text,
	"allowed_tools" text,
	"for_ai" boolean DEFAULT false NOT NULL,
	"for_copilot" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."opening_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"days" text[] DEFAULT '{}'::text[] NOT NULL,
	"opens" text,
	"closes" text,
	"site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."promoted_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"status" text,
	"origin" text,
	"conversation_url" text,
	"promoted_by" uuid,
	"reviewed_by" uuid,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domains" text,
	"welcome" text,
	"suggestions" text,
	"color" text,
	"title" text,
	"tagline" text,
	"position" text,
	"offset_x" integer,
	"offset_y" integer,
	"launcher" text,
	"launcher_label" text,
	"font" text,
	"custom_font" text,
	"theme" text,
	"corners" text,
	"logo" text,
	"hide_team" boolean DEFAULT false NOT NULL,
	"nudge_after" integer,
	"hide_on_mobile" boolean DEFAULT false NOT NULL,
	"hide_when_closed" boolean DEFAULT false NOT NULL,
	"hide_branding" boolean DEFAULT false NOT NULL,
	"language" text,
	"time_zone" text,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"ai_threshold" integer,
	"ai_instructions" text,
	"retention_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"inbox_id" uuid,
	"default_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."tag_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"when_to_apply" text,
	"by_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "login" text;--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "max_conversations" integer;--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."agent_team" ADD CONSTRAINT "agent_team_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."agent_team" ADD CONSTRAINT "agent_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "chat"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."article_site" ADD CONSTRAINT "article_site_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "chat"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."article_site" ADD CONSTRAINT "article_site_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "chat"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."article" ADD CONSTRAINT "article_author_id_agent_id_fk" FOREIGN KEY ("author_id") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."article" ADD CONSTRAINT "article_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "chat"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."canned_reply_team" ADD CONSTRAINT "canned_reply_team_canned_reply_id_canned_reply_id_fk" FOREIGN KEY ("canned_reply_id") REFERENCES "chat"."canned_reply"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."canned_reply_team" ADD CONSTRAINT "canned_reply_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "chat"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."closure" ADD CONSTRAINT "closure_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "chat"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."guardrail" ADD CONSTRAINT "guardrail_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "chat"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."inbox_team" ADD CONSTRAINT "inbox_team_inbox_id_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "chat"."inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."inbox_team" ADD CONSTRAINT "inbox_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "chat"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."inbox" ADD CONSTRAINT "inbox_default_team_id_team_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "chat"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."opening_slot" ADD CONSTRAINT "opening_slot_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "chat"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."promoted_conversation" ADD CONSTRAINT "promoted_conversation_promoted_by_agent_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."promoted_conversation" ADD CONSTRAINT "promoted_conversation_reviewed_by_agent_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."promoted_conversation" ADD CONSTRAINT "promoted_conversation_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "chat"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."site" ADD CONSTRAINT "site_inbox_id_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "chat"."inbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."site" ADD CONSTRAINT "site_default_team_id_team_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "chat"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."agent" ADD CONSTRAINT "agent_login_unique" UNIQUE("login");--> statement-breakpoint
-- The agents sign in by their e-mail now (D19); the integration tokens keep their key.
UPDATE "chat"."agent" SET "login" = CASE WHEN "basedb_user_id" LIKE 'token:%' OR "email" IS NULL THEN "basedb_user_id" ELSE lower("email") END;
