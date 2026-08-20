ALTER TABLE "pets" ADD COLUMN "last_interaction_time" timestamp;
--> statement-breakpoint
CREATE INDEX "idx_pets_last_interaction" ON "pets" ("last_interaction_time");
