ALTER TABLE "adoptions" ADD COLUMN "happiness" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "adoptions" ADD COLUMN "last_interacted_at" timestamp;