ALTER TABLE "adoptions" ADD COLUMN "level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "adoptions" ADD COLUMN "chat_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "adoptions" ADD COLUMN "monthly_points" integer DEFAULT 0 NOT NULL;