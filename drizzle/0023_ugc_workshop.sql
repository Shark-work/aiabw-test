-- 宠物旅行日记 · UGC 内容创作工坊（drizzle/0023_ugc_workshop.sql）
-- 幂等：与 drizzle/0022 风格一致，可在已存在表上重复执行。
--
-- P0 落地：ugc_creations（日记卡片 / AI 写真 / 表情包 生成记录）
-- P1 预留：ugc_campaigns + ugc_submissions（征集活动 / 投稿审核流）

CREATE TABLE IF NOT EXISTS "ugc_creations" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    uuid NOT NULL REFERENCES "users"("id"),
  "pet_id"     text,
  "type"       text NOT NULL CHECK ("type" IN ('portrait', 'diary_card', 'sticker')),
  "style"      text,
  "image_url"  text NOT NULL,
  "is_premium" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ugc_campaigns" (
  "id"            text PRIMARY KEY,
  "title"         text NOT NULL,
  "description"   text,
  "start_date"    timestamp,
  "end_date"      timestamp,
  "reward_points" integer DEFAULT 0 NOT NULL,
  "is_active"     boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ugc_submissions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id"  text NOT NULL REFERENCES "ugc_campaigns"("id"),
  "user_id"      uuid NOT NULL REFERENCES "users"("id"),
  "content_type" text NOT NULL CHECK ("content_type" IN ('image', 'video', 'text')),
  "content_url"  text,
  "status"       text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'approved', 'rejected', 'featured')),
  "likes"        integer DEFAULT 0 NOT NULL,
  "created_at"   timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ugc_creations_user" ON "ugc_creations" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ugc_creations_type" ON "ugc_creations" ("user_id", "type", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ugc_submissions_campaign" ON "ugc_submissions" ("campaign_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ugc_submissions_user" ON "ugc_submissions" ("user_id", "created_at" DESC);
