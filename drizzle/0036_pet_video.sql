-- Phase 10 灵宠日常短视频（SCHEMA_VERSION 21）
-- video_generations：一次「生成日常视频」的完整生命周期记录
--   pending → processing（可灵已接单）→ succeeded（已转存 Blob）/ failed（自动退还当日次数）
-- 配额口径：当日 COUNT(status != 'failed') >= users.video_quota → 拒绝；failed 不计数 = 失败自动退还。
-- users.video_quota：每日视频额度（默认 1，预留与 XorPay/Stripe 订单打通的付费扩容字段）。

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
