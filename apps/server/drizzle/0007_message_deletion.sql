CREATE TABLE "chat"."hidden_message" (
	"message_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_message_message_id_agent_id_pk" PRIMARY KEY("message_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "chat"."message" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "chat"."hidden_message" ADD CONSTRAINT "hidden_message_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."hidden_message" ADD CONSTRAINT "hidden_message_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "chat"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_deleted_by_agent_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "chat"."agent"("id") ON DELETE set null ON UPDATE no action;