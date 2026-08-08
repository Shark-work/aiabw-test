CREATE TABLE "handbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"adoption_id" uuid,
	"title" text,
	"content" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_checkin_date" text;--> statement-breakpoint
ALTER TABLE "handbooks" ADD CONSTRAINT "handbooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbooks" ADD CONSTRAINT "handbooks_adoption_id_adoptions_id_fk" FOREIGN KEY ("adoption_id") REFERENCES "public"."adoptions"("id") ON DELETE no action ON UPDATE no action;