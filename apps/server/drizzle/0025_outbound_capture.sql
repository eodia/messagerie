-- What leaves the chat (D23), captured in the transaction that writes the message — whichever
-- way it is written: the inbox, the AI, an automation, the API.
--
-- - In an SMS or RCS conversation, every answer goes to the visitor's phone — the AI's
--   handing over is announced by an answer of its own.
-- - In the widget, an answer to a visitor who left their e-mail waits two minutes: the
--   postman sends it by e-mail if they did not see it meanwhile, with what followed.
-- A message written in the past (the seed, an import) leaves nothing.
CREATE OR REPLACE FUNCTION "chat"."capture_outbound"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held "chat"."channel";
  address text;
BEGIN
  IF NEW."author" NOT IN ('agent', 'ai') OR NEW."kind" <> 'text' THEN
    RETURN NULL;
  END IF;
  IF NEW."created_at" < now() - interval '10 minutes' THEN RETURN NULL; END IF;
  SELECT c."channel", ct."email" INTO held, address
    FROM "chat"."conversation" c
    JOIN "chat"."contact" ct ON ct."id" = c."contact_id"
   WHERE c."id" = NEW."conversation_id";
  IF held IN ('sms', 'rcs') THEN
    INSERT INTO "chat"."outbound" ("channel", "purpose", "conversation_id", "message_id")
      VALUES ('sms', 'message', NEW."conversation_id", NEW."id");
  ELSIF address IS NOT NULL THEN
    INSERT INTO "chat"."outbound" ("channel", "purpose", "conversation_id", "message_id", "next_attempt_at")
      VALUES ('email', 'visitor_reply', NEW."conversation_id", NEW."id", now() + interval '2 minutes');
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "outbound_message" AFTER INSERT ON "chat"."message"
  FOR EACH ROW EXECUTE FUNCTION "chat"."capture_outbound"();--> statement-breakpoint
-- The dashboards read where a conversation was held (D22).
CREATE OR REPLACE VIEW "analytics"."conversations" AS
  SELECT c.id,
         c.created_at,
         c.status::text AS status,
         i.name AS inbox,
         t.name AS team,
         c.site_name AS site,
         c.priority::text AS priority,
         c.sentiment::text AS sentiment,
         a.name AS assignee,
         ct.identified,
         ct.country,
         coalesce(m.ai_answered, false) AS ai_answered,
         coalesce(m.agent_answered, false) AS agent_answered,
         coalesce(m.handed_off, false) AS handed_off,
         coalesce(m.ai_answered and not m.handed_off and not m.agent_answered, false) AS resolved_by_ai,
         m.first_response_seconds,
         coalesce(m.messages, 0) AS messages,
         c.last_message_at,
         c.channel::text AS channel
    FROM chat.conversation c
    JOIN chat.contact ct ON ct.id = c.contact_id
    LEFT JOIN chat.inbox i ON i.id::text = c.inbox_id
    LEFT JOIN chat.team t ON t.id::text = c.team_id
    LEFT JOIN chat.agent a ON a.id = c.assignee_id
    LEFT JOIN LATERAL (
      SELECT bool_or(x.author = 'ai' AND x.kind = 'text') AS ai_answered,
             bool_or(x.author = 'agent' AND x.kind = 'text') AS agent_answered,
             bool_or(x.kind = 'handoff') AS handed_off,
             extract(epoch FROM (
               min(x.created_at) FILTER (WHERE x.author IN ('ai', 'agent') AND x.kind = 'text')
               - min(x.created_at) FILTER (WHERE x.author = 'contact')
             ))::float AS first_response_seconds,
             count(*) FILTER (WHERE x.kind IN ('text', 'file'))::int AS messages
        FROM chat.message x
       WHERE x.conversation_id = c.id
    ) m ON true;
