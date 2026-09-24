-- 0021_achievements.sql
-- 探索成就系统（roadmap 任务二，2026-09-23）：用户徽章解锁记录
--
-- 设计说明（对 roadmap §二「技术落地」的代码核实修正）：
--  - 不设 achievement_progress 表：8 枚徽章的进度全部可由源表实时推导
--    （exploration_records / knowledge_link / users.checkin_streak /
--      adoptions.happiness / V1 口径 max(Σsteps÷100, postcards)），
--    冗余进度表有双写不一致风险且无法自动覆盖 V1 老数据；
--  - progress 列仅保存解锁时刻的进度快照（便于运营回溯）；
--  - UNIQUE(user_id, badge_id) + ON CONFLICT DO NOTHING 保证并发/重复触发幂等。

CREATE TABLE IF NOT EXISTS "achievements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "badge_id" text NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "unlocked_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "achievements_user_badge_unique" UNIQUE ("user_id", "badge_id")
);

CREATE INDEX IF NOT EXISTS "idx_achievements_user" ON "achievements" ("user_id");
