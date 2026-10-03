CREATE TABLE "chat"."dashboard_preset" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."survey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"scale" text NOT NULL,
	"question" text,
	"asked_by" text,
	"agent_id" uuid,
	"score" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."survey" ADD CONSTRAINT "survey_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."survey" ADD CONSTRAINT "survey_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_conversation_idx" ON "chat"."survey" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "survey_created_idx" ON "chat"."survey" USING btree ("created_at");--> statement-breakpoint
-- The visitor's answer to a satisfaction survey: an event of its own (D17), for the
-- automations and the webhooks — `survey.answered`, with its message.
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
    ELSIF NEW."kind" = 'event' AND NEW."meta"->'event'->>'type' = 'survey_answered' THEN
      INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at", "caused_by")
        VALUES ('survey.answered', NEW."conversation_id", NEW."id", box, clock_timestamp(), "chat"."event_cause"());
    END IF;
  ELSIF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('message.deleted', NEW."conversation_id", NEW."id", box, clock_timestamp(), "chat"."event_cause"());
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
-- What the dashboards read of the surveys (D22): one row a survey asked, its score once
-- answered. `satisfied`: 4 or 5 of 5, 9 or 10 of 10; `nps_points`: +100 a promoter, -100 a
-- detractor, 0 otherwise — their average is the NPS.
CREATE OR REPLACE VIEW "analytics"."surveys" AS
  SELECT s.id,
         s.created_at,
         s.answered_at,
         s.conversation_id,
         s.scale,
         s.score,
         s.score::text AS score_label,
         (s.score IS NOT NULL) AS answered,
         CASE WHEN s.score IS NULL THEN NULL
              WHEN s.scale = 'csat' THEN s.score >= 4
              ELSE s.score >= 9 END AS satisfied,
         CASE WHEN s.scale <> 'nps' OR s.score IS NULL THEN NULL
              WHEN s.score >= 9 THEN 100
              WHEN s.score <= 6 THEN -100
              ELSE 0 END AS nps_points,
         a.name AS agent,
         CASE WHEN s.agent_id IS NULL THEN 'ai' ELSE 'agent' END AS handled_by,
         i.name AS inbox,
         t.name AS team,
         c.site_name AS site,
         s.comment
    FROM chat.survey s
    JOIN chat.conversation c ON c.id = s.conversation_id
    LEFT JOIN chat.agent a ON a.id = s.agent_id
    LEFT JOIN chat.inbox i ON i.id::text = c.inbox_id
    LEFT JOIN chat.team t ON t.id::text = c.team_id;--> statement-breakpoint
-- What the visitors wrote with their score, the newest first: to read as rows.
CREATE OR REPLACE VIEW "analytics"."survey_comments" AS
  SELECT s.id,
         s.answered_at AS created_at,
         s.scale,
         s.score,
         a.name AS agent,
         c.site_name AS site,
         i.name AS inbox,
         s.comment
    FROM chat.survey s
    JOIN chat.conversation c ON c.id = s.conversation_id
    LEFT JOIN chat.agent a ON a.id = s.agent_id
    LEFT JOIN chat.inbox i ON i.id::text = c.inbox_id
   WHERE s.comment IS NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  GRANT SELECT ON "analytics"."surveys", "analytics"."survey_comments" TO chat_analytics;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'chat_analytics : vue des enquêtes non accordée';
END
$$;--> statement-breakpoint
-- A messaging with dashboards already was given « Vue d'ensemble »: not again.
INSERT INTO "chat"."dashboard_preset" ("key")
  SELECT 'overview' WHERE EXISTS (SELECT 1 FROM "chat"."dashboard");
