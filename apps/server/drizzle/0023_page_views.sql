CREATE TABLE "chat"."page_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."page_view" ADD CONSTRAINT "page_view_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_view_conversation_idx" ON "chat"."page_view" USING btree ("conversation_id","created_at");