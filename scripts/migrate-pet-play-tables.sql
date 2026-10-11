-- ════════════════════════════════════════════════════════════════════════
-- migrate-pet-play-tables.sql · AI 宠物互动页手动迁移副本（drizzle/0038 同内容）
--
-- 用途：生产环境经 scripts/db-migrate-prod.mjs 版本闸门自动同步（SCHEMA_VERSION 23）；
-- 本文件仅供 DBA 手动执行 / 审计对照（与 scripts/migrate-worldview-tables.sql 同模式）。
--
-- 需求 4 表映射（详注见 drizzle/0038_pet_play.sql 头部）：
--   pets         → 既有 adoptions（+本文件 hunger_level 新列；mood=happiness；intimacy=level/chat_count）
--   items        → 代码常量 src/lib/pet-play-config.ts PLAY_ITEMS（运营配置，免迁移）
--   user_backpack→ 既有 user_items（source='pet_play'，数量=COUNT(*) 聚合）
--   chat_logs    → 本文件 pet_play_logs（+adoption_id / action 扩展）
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "hunger_level" integer DEFAULT 50 NOT NULL;

CREATE TABLE IF NOT EXISTS "pet_play_logs" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"     uuid NOT NULL REFERENCES "users"("id"),
  "adoption_id" uuid NOT NULL REFERENCES "adoptions"("id"),
  "user_input"  text NOT NULL,
  "pet_reply"   text NOT NULL,
  "emotion"     text NOT NULL DEFAULT 'idle',
  "action"      text NOT NULL DEFAULT 'idle',
  "created_at"  timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pet_play_logs_user"     ON "pet_play_logs" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_pet_play_logs_adoption" ON "pet_play_logs" ("adoption_id", "created_at");
