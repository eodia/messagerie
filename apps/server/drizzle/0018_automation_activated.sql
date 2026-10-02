ALTER TABLE "chat"."automation" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "chat"."automation" SET "activated_at" = "updated_at" WHERE "is_active";
