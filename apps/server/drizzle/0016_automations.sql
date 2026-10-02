ALTER TYPE "chat"."ai_run_kind" ADD VALUE 'automation';--> statement-breakpoint
ALTER TYPE "chat"."alert_kind" ADD VALUE 'automation';--> statement-breakpoint
CREATE TABLE "chat"."automation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"cause" jsonb NOT NULL,
	"input" jsonb,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_after" text,
	"resume_at" timestamp with time zone,
	"waiting_since" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"depth" integer DEFAULT 0 NOT NULL,
	"dedup_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat"."automation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"trigger" jsonb NOT NULL,
	"condition" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_id" uuid NOT NULL,
	"webhook_key" text,
	"next_run_at" timestamp with time zone,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."change_event" ADD COLUMN "automated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."change_event" ADD COLUMN "caused_by" uuid;--> statement-breakpoint
ALTER TABLE "chat"."notification" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "chat"."automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "chat"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."automation_run" ADD CONSTRAINT "automation_run_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."automation" ADD CONSTRAINT "automation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."automation" ADD CONSTRAINT "automation_created_by_agent_id_fk" FOREIGN KEY ("created_by") REFERENCES "chat"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_run_due_idx" ON "chat"."automation_run" USING btree ("status","resume_at");--> statement-breakpoint
CREATE INDEX "automation_run_log_idx" ON "chat"."automation_run" USING btree ("automation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_dedup_key" ON "chat"."automation_run" USING btree ("automation_id","dedup_key") WHERE dedup_key is not null;--> statement-breakpoint
CREATE INDEX "change_event_unautomated_idx" ON "chat"."change_event" USING btree ("occurred_at") WHERE automated_at is null;--> statement-breakpoint
-- What happened before the automations is not theirs to act on.
UPDATE "chat"."change_event" SET "automated_at" = now();--> statement-breakpoint
-- Events are captured while a webhook or an automation listens (D17, D20), with the run of
-- the automation that caused them, if one did: `set local chat.automation_run`.
CREATE OR REPLACE FUNCTION "chat"."events_listen"() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "chat"."webhook" WHERE "is_active" AND "deleted_at" IS NULL)
    OR EXISTS (SELECT 1 FROM "chat"."automation" WHERE "is_active" AND "deleted_at" IS NULL)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "chat"."event_cause"() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('chat.automation_run', true), '')::uuid
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "chat"."capture_message"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  box text;
BEGIN
  IF NOT "chat"."events_listen"() THEN RETURN NULL; END IF;
  SELECT "inbox_id" INTO box FROM "chat"."conversation" WHERE "id" = NEW."conversation_id";
  IF TG_OP = 'INSERT' THEN
    IF NEW."kind" IN ('text', 'note') THEN
      INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at", "caused_by")
        VALUES ('message.created', NEW."conversation_id", NEW."id", box, clock_timestamp(), "chat"."event_cause"());
    ELSIF NEW."kind" = 'handoff' THEN
      INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at", "caused_by")
        VALUES ('conversation.handed_off', NEW."conversation_id", NEW."id", box, clock_timestamp(), "chat"."event_cause"());
    END IF;
  ELSIF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('message.deleted', NEW."conversation_id", NEW."id", box, clock_timestamp(), "chat"."event_cause"());
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "chat"."capture_conversation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cause uuid;
BEGIN
  IF NOT "chat"."events_listen"() THEN RETURN NULL; END IF;
  cause := "chat"."event_cause"();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('conversation.created', NEW."id", NEW."inbox_id", clock_timestamp(), cause);
    RETURN NULL;
  END IF;
  IF NEW."status" = 'resolved' AND OLD."status" <> 'resolved' THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('conversation.resolved', NEW."id", NEW."inbox_id", clock_timestamp(), cause);
  ELSIF OLD."status" = 'resolved' AND NEW."status" <> 'resolved' THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('conversation.reopened', NEW."id", NEW."inbox_id", clock_timestamp(), cause);
  END IF;
  IF NEW."assignee_id" IS DISTINCT FROM OLD."assignee_id" THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('conversation.assigned', NEW."id", NEW."inbox_id", clock_timestamp(), cause);
  END IF;
  IF NEW."inbox_id" IS DISTINCT FROM OLD."inbox_id" OR NEW."team_id" IS DISTINCT FROM OLD."team_id" THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('conversation.transferred', NEW."id", NEW."inbox_id", clock_timestamp(), cause);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
DROP FUNCTION "chat"."webhooks_listen"();
