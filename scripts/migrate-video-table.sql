-- 灵宠日常短视频 · video_generations 手动迁移副本（与 drizzle/0036_pet_video.sql 内容一致）。
-- 注意：本项目惯例为 src/db/client.ts 冷启动自动同步 + scripts/db-migrate-prod.mjs 手动触发；
-- 本文件仅供需要绕开自动同步的手工 psql 场景使用。幂等，可重复执行。

CREATE TABLE IF NOT EXISTS "video_generations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "pet_id" text NOT NULL,
  "task_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "script" jsonb,
  "video_url" text,
  "source_url" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_generations_user_day ON "video_generations" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_video_generations_task ON "video_generations" ("task_id");
CREATE INDEX IF NOT EXISTS idx_video_generations_status ON "video_generations" ("status");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "video_quota" integer DEFAULT 1 NOT NULL;
