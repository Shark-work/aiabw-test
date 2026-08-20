CREATE TABLE "pet_dictionary" (
	"id" text PRIMARY KEY NOT NULL,
	"name_zh" text NOT NULL,
	"name_en" text NOT NULL,
	"category" text NOT NULL,
	"habitat" text,
	"default_description_zh" text NOT NULL,
	"default_description_en" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pets" (
	"id" text PRIMARY KEY NOT NULL,
	"species_id" text NOT NULL,
	"image_url" text NOT NULL,
	"traits" jsonb DEFAULT '{}' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"parent_ids" jsonb,
	"custom_description" text,
	"owner_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"adopted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_species_id_pet_dictionary_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."pet_dictionary"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_pets_traits_gin" ON "pets" USING gin ("traits");
--> statement-breakpoint
CREATE INDEX "idx_pets_owner_id" ON "pets" ("owner_id");
--> statement-breakpoint
CREATE INDEX "idx_pets_species_id" ON "pets" ("species_id");
