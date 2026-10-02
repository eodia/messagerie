-- The mood the AI reads arrives after the message (D20): an event of its own, for the
-- automations — no webhook listens to it, its drain leaves it be.
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
  IF NEW."sentiment" IS NOT NULL AND NEW."sentiment" IS DISTINCT FROM OLD."sentiment" THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at", "caused_by")
      VALUES ('conversation.sentiment', NEW."id", NEW."inbox_id", clock_timestamp(), cause);
  END IF;
  RETURN NULL;
END
$$;
