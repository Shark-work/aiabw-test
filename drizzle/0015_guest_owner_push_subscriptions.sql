-- 0015: P1 零摩擦领养（guest_owner）+ P2 Web Push 召回（push_subscriptions）
-- 说明：运行时由 src/db/client.ts 的 ensureDbSchemaOnce() 幂等执行
--   （CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS），
--   本文件与 0012-0014 相同，作为变更记录（迁移文档）；
--   已有生产库无需手动执行；全新空库可先跑 0000-0011 再执行本文件对齐。
ALTER TABLE "pets" ADD COLUMN "guest_owner" text;
--> statement-breakpoint
CREATE INDEX "idx_pets_guest_owner" ON "pets" ("guest_owner");
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_id" text,
  "anonymous_id" text,
  "locale" text DEFAULT 'zh' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_notified_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "idx_push_sub_user" ON "push_subscriptions" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_push_sub_anon" ON "push_subscriptions" ("anonymous_id");

COMMENT ON COLUMN pets.guest_owner IS 'P1 游客领养占位（anonymousId）；登录后由 /api/auth/migrate 归并到 owner_id 并清空';
COMMENT ON COLUMN push_subscriptions.last_notified_at IS 'P2 防打扰：同一订阅 7 天内最多召回一次（cron /api/cron/push-recall 维护）';
