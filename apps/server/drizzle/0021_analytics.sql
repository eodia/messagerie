-- What the dashboards read (D22): views of the conversations, in a schema of their own —
-- never the accounts, the sessions, the secrets. SQL questions run as `chat_analytics`,
-- which may read these views and nothing else.
CREATE SCHEMA IF NOT EXISTS "analytics";--> statement-breakpoint
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
         c.last_message_at
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
    ) m ON true;--> statement-breakpoint
CREATE OR REPLACE VIEW "analytics"."messages" AS
  SELECT m.id,
         m.created_at,
         m.conversation_id,
         m.author::text AS author,
         m.kind::text AS kind,
         a.name AS agent,
         i.name AS inbox,
         (m.deleted_at IS NOT NULL) AS deleted
    FROM chat.message m
    JOIN chat.conversation c ON c.id = m.conversation_id
    LEFT JOIN chat.agent a ON a.id = m.agent_id
    LEFT JOIN chat.inbox i ON i.id::text = c.inbox_id
   WHERE m.kind IN ('text', 'note', 'file', 'handoff');--> statement-breakpoint
CREATE OR REPLACE VIEW "analytics"."ai_runs" AS
  SELECT r.id,
         r.created_at,
         r.conversation_id,
         r.kind::text AS kind,
         r.model,
         r.confidence,
         r.latency_ms,
         (r.output->'usage'->>'promptTokens')::int AS prompt_tokens,
         (r.output->'usage'->>'completionTokens')::int AS completion_tokens
    FROM chat.ai_run r;--> statement-breakpoint
CREATE OR REPLACE VIEW "analytics"."ai_feedback" AS
  SELECT f.id,
         f.created_at,
         f.action::text AS verdict,
         a.name AS agent,
         r.kind::text AS run_kind
    FROM chat.ai_feedback f
    JOIN chat.ai_run r ON r.id = f.ai_run_id
    LEFT JOIN chat.agent a ON a.id = f.agent_id;--> statement-breakpoint
CREATE OR REPLACE VIEW "analytics"."tags" AS
  SELECT g.conversation_id,
         g.label,
         g.origin::text AS origin,
         g.created_at,
         c.created_at AS conversation_created_at,
         i.name AS inbox
    FROM chat.conversation_tag g
    JOIN chat.conversation c ON c.id = g.conversation_id
    LEFT JOIN chat.inbox i ON i.id::text = c.inbox_id;--> statement-breakpoint
CREATE OR REPLACE VIEW "analytics"."contacts" AS
  SELECT ct.id,
         ct.created_at,
         ct.identified,
         ct.country,
         ct.segment,
         (ct.email IS NOT NULL) AS has_email
    FROM chat.contact ct;--> statement-breakpoint
CREATE OR REPLACE VIEW "analytics"."automation_runs" AS
  SELECT r.id,
         r.created_at,
         a.name AS automation,
         a.trigger->>'kind' AS trigger,
         r.status,
         r.conversation_id,
         extract(epoch FROM (r.finished_at - r.created_at))::float AS seconds
    FROM chat.automation_run r
    JOIN chat.automation a ON a.id = r.automation_id;--> statement-breakpoint
-- The reading role: these views, and nothing else. Where the database user may not make
-- roles, SQL questions are off, and say so.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chat_analytics') THEN
    CREATE ROLE chat_analytics NOLOGIN;
  END IF;
  EXECUTE format('GRANT chat_analytics TO %I', current_user);
  GRANT USAGE ON SCHEMA analytics TO chat_analytics;
  GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO chat_analytics;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'chat_analytics : rôle non créé, questions SQL indisponibles';
END
$$;
