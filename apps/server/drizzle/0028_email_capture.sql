-- The e-mail channel (D24): in a conversation held by e-mail, every answer goes to the
-- customer's mailbox at once — no waiting to see whether they come back, as for a visitor
-- of the widget (D23).
CREATE OR REPLACE FUNCTION "chat"."capture_outbound"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held text;
  address text;
BEGIN
  IF NEW."author" NOT IN ('agent', 'ai') OR NEW."kind" <> 'text' THEN
    RETURN NULL;
  END IF;
  IF NEW."created_at" < now() - interval '10 minutes' THEN RETURN NULL; END IF;
  SELECT c."channel"::text, ct."email" INTO held, address
    FROM "chat"."conversation" c
    JOIN "chat"."contact" ct ON ct."id" = c."contact_id"
   WHERE c."id" = NEW."conversation_id";
  IF held IN ('sms', 'rcs') THEN
    INSERT INTO "chat"."outbound" ("channel", "purpose", "conversation_id", "message_id")
      VALUES ('sms', 'message', NEW."conversation_id", NEW."id");
  ELSIF held = 'email' THEN
    INSERT INTO "chat"."outbound" ("channel", "purpose", "conversation_id", "message_id")
      VALUES ('email', 'message', NEW."conversation_id", NEW."id");
  ELSIF address IS NOT NULL THEN
    INSERT INTO "chat"."outbound" ("channel", "purpose", "conversation_id", "message_id", "next_attempt_at")
      VALUES ('email', 'visitor_reply', NEW."conversation_id", NEW."id", now() + interval '2 minutes');
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
-- An answer that did not reach the customer — refused by the provider, the SMTP server, or
-- after its last try — is an event (D17, D20): « message.undelivered », for the webhooks
-- and the automations. Seen ones (`skipped`) are no failure.
CREATE OR REPLACE FUNCTION "chat"."capture_undelivered"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  box text;
BEGIN
  IF NEW."status" <> 'failed' OR OLD."status" = 'failed' OR NEW."message_id" IS NULL
     OR NEW."purpose" NOT IN ('message', 'visitor_reply') THEN
    RETURN NULL;
  END IF;
  IF NOT "chat"."events_listen"() THEN RETURN NULL; END IF;
  SELECT "inbox_id" INTO box FROM "chat"."conversation" WHERE "id" = NEW."conversation_id";
  INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at", "caused_by")
    VALUES ('message.undelivered', NEW."conversation_id", NEW."message_id", box, clock_timestamp(), "chat"."event_cause"());
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "outbound_undelivered" AFTER UPDATE OF "status" ON "chat"."outbound"
  FOR EACH ROW EXECUTE FUNCTION "chat"."capture_undelivered"();
