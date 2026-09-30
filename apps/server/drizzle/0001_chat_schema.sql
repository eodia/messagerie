CREATE SCHEMA IF NOT EXISTS "chat";
--> statement-breakpoint
CREATE TYPE "chat"."ai_run_kind" AS ENUM('answer', 'suggestion', 'tag', 'summary');--> statement-breakpoint
CREATE TYPE "chat"."chunk_source" AS ENUM('article', 'conversation');--> statement-breakpoint
CREATE TYPE "chat"."conversation_status" AS ENUM('ai', 'open', 'pending', 'resolved');--> statement-breakpoint
CREATE TYPE "chat"."feedback_action" AS ENUM('accepted', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "chat"."message_author" AS ENUM('contact', 'agent', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "chat"."message_kind" AS ENUM('text', 'note', 'event', 'handoff', 'file');--> statement-breakpoint
CREATE TYPE "chat"."priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "chat"."sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "chat"."tag_origin" AS ENUM('agent', 'ai');--> statement-breakpoint
CREATE TABLE "chat"."access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basedb_user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'agent' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_basedb_user_id_unique" UNIQUE("basedb_user_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."ai_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"action" "chat"."feedback_action" NOT NULL,
	"final_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_feedback_run_agent_key" UNIQUE("ai_run_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."ai_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" "chat"."ai_run_kind" NOT NULL,
	"model" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real,
	"latency_ms" integer,
	"cost_eur" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"email" text,
	"identified" boolean DEFAULT false NOT NULL,
	"location" text,
	"segment" text,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_site_external_key" UNIQUE("site_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."conversation_tag" (
	"conversation_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"origin" "chat"."tag_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tag_conversation_id_label_pk" PRIMARY KEY("conversation_id","label")
);
--> statement-breakpoint
CREATE TABLE "chat"."conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"site_name" text NOT NULL,
	"status" "chat"."conversation_status" DEFAULT 'ai' NOT NULL,
	"assignee_id" uuid,
	"team_id" text,
	"priority" "chat"."priority" DEFAULT 'normal' NOT NULL,
	"sentiment" "chat"."sentiment",
	"intent" text,
	"summary" text,
	"agent_unread" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."kb_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "chat"."chunk_source" NOT NULL,
	"source_id" text NOT NULL,
	"conversation_id" uuid,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author" "chat"."message_author" NOT NULL,
	"kind" "chat"."message_kind" DEFAULT 'text' NOT NULL,
	"agent_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."site_secret" (
	"site_id" text PRIMARY KEY NOT NULL,
	"identity_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."access_log" ADD CONSTRAINT "access_log_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."access_log" ADD CONSTRAINT "access_log_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."ai_feedback" ADD CONSTRAINT "ai_feedback_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "chat"."ai_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."ai_feedback" ADD CONSTRAINT "ai_feedback_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."ai_run" ADD CONSTRAINT "ai_run_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."attachment" ADD CONSTRAINT "attachment_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversation_tag" ADD CONSTRAINT "conversation_tag_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "chat"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversation" ADD CONSTRAINT "conversation_assignee_id_agent_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."kb_chunk" ADD CONSTRAINT "kb_chunk_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "chat"."ai_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_conversation_idx" ON "chat"."access_log" USING btree ("conversation_id","at");--> statement-breakpoint
CREATE INDEX "ai_run_conversation_idx" ON "chat"."ai_run" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_inbox_idx" ON "chat"."conversation" USING btree ("status","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_site_idx" ON "chat"."conversation" USING btree ("site_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_contact_idx" ON "chat"."conversation" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "kb_chunk_source_idx" ON "chat"."kb_chunk" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "kb_chunk_embedding_idx" ON "chat"."kb_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "chat"."message" USING btree ("conversation_id","created_at");