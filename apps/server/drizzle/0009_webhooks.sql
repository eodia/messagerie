CREATE TABLE "chat"."change_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"inbox_id" text,
	"webhook_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drained_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat"."webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"partition_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"response_code" integer,
	"error_code" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"target_url" text NOT NULL,
	"signing_secret" text NOT NULL,
	"events" text[] NOT NULL,
	"inbox_ids" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."change_event" ADD CONSTRAINT "change_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "chat"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_event_id_change_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "chat"."change_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."webhook" ADD CONSTRAINT "webhook_created_by_agent_id_fk" FOREIGN KEY ("created_by") REFERENCES "chat"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_event_undrained_idx" ON "chat"."change_event" USING btree ("occurred_at") WHERE drained_at is null;--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "chat"."webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_partition_idx" ON "chat"."webhook_delivery" USING btree ("partition_key","created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_log_idx" ON "chat"."webhook_delivery" USING btree ("webhook_id","created_at");--> statement-breakpoint
-- What happens in the conversations, captured in the transaction that does it (D17) — and
-- only while a webhook listens: no webhook, no row. Stamped by the clock, not by the
-- transaction's start: two events of one transaction keep their order.
CREATE OR REPLACE FUNCTION "chat"."webhooks_listen"() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "chat"."webhook" WHERE "is_active" AND "deleted_at" IS NULL)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "chat"."capture_message"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  box text;
BEGIN
  IF NOT "chat"."webhooks_listen"() THEN RETURN NULL; END IF;
  SELECT "inbox_id" INTO box FROM "chat"."conversation" WHERE "id" = NEW."conversation_id";
  IF TG_OP = 'INSERT' THEN
    IF NEW."kind" IN ('text', 'note') THEN
      INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at")
        VALUES ('message.created', NEW."conversation_id", NEW."id", box, clock_timestamp());
    ELSIF NEW."kind" = 'handoff' THEN
      INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at")
        VALUES ('conversation.handed_off', NEW."conversation_id", NEW."id", box, clock_timestamp());
    END IF;
  ELSIF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "message_id", "inbox_id", "occurred_at")
      VALUES ('message.deleted', NEW."conversation_id", NEW."id", box, clock_timestamp());
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "message_capture" AFTER INSERT OR UPDATE OF "deleted_at" ON "chat"."message"
  FOR EACH ROW EXECUTE FUNCTION "chat"."capture_message"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "chat"."capture_conversation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "chat"."webhooks_listen"() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at")
      VALUES ('conversation.created', NEW."id", NEW."inbox_id", clock_timestamp());
    RETURN NULL;
  END IF;
  IF NEW."status" = 'resolved' AND OLD."status" <> 'resolved' THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at")
      VALUES ('conversation.resolved', NEW."id", NEW."inbox_id", clock_timestamp());
  ELSIF OLD."status" = 'resolved' AND NEW."status" <> 'resolved' THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at")
      VALUES ('conversation.reopened', NEW."id", NEW."inbox_id", clock_timestamp());
  END IF;
  IF NEW."assignee_id" IS DISTINCT FROM OLD."assignee_id" THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at")
      VALUES ('conversation.assigned', NEW."id", NEW."inbox_id", clock_timestamp());
  END IF;
  IF NEW."inbox_id" IS DISTINCT FROM OLD."inbox_id" OR NEW."team_id" IS DISTINCT FROM OLD."team_id" THEN
    INSERT INTO "chat"."change_event" ("type", "conversation_id", "inbox_id", "occurred_at")
      VALUES ('conversation.transferred', NEW."id", NEW."inbox_id", clock_timestamp());
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "conversation_capture" AFTER INSERT OR UPDATE ON "chat"."conversation"
  FOR EACH ROW EXECUTE FUNCTION "chat"."capture_conversation"();
