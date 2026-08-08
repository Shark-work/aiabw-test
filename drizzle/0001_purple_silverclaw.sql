CREATE TABLE "adoptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT 'anonymous' NOT NULL,
	"pet_name" text NOT NULL,
	"adopted_at" timestamp DEFAULT now() NOT NULL
);
