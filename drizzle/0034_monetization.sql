-- 0034_monetization.sql
-- 产品升级 Phase 1（2026-10-05）：变现基建三新表 + pets 养成字段
--
--   promoted_content  推荐曝光位（排行榜/列表付费推荐；查询 JOIN 生效窗口
--                     start_time~end_time 并按 priority 降序；views 累计曝光；
--                     到期自动不再命中，行保留供统计）
--   first_purchase    首充记录（user_id 主键 = 一人一行天然幂等；支付成功后写入
--                     package_type/points_received/bonus_points，is_claimed 赠品标记）
--   pity_counter      盲盒/卡包保底计数（复合主键 user_id+pool_id；每抽 +1，
--                     出稀有即清零，达阈值强制出货；last_reset 预留每日重置口径）
--   pets              养成字段 level/exp/last_feed_time/evolution_stage
--                     （宠物本体口径，与 adoptions.level 领养关系级独立）
--
-- points_log.reason 为 text 无 CHECK 约束，新增值域
--   first_purchase_bonus / pity_reward / promotion_purchase / style_unlock
--   无需 DDL，由应用层写入。
--
-- 幂等：CREATE TABLE/INDEX IF NOT EXISTS + ADD COLUMN IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS "promoted_content" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_type" text NOT NULL,
  "content_id" uuid NOT NULL,
  "promoter_id" uuid REFERENCES "users"("id"),
  "start_time" timestamp NOT NULL,
  "end_time" timestamp NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_promoted_content_type_time" ON "promoted_content" ("content_type", "start_time", "end_time");
CREATE INDEX IF NOT EXISTS "idx_promoted_content_promoter" ON "promoted_content" ("promoter_id");

CREATE TABLE IF NOT EXISTS "first_purchase" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id"),
  "purchased_at" timestamp DEFAULT now() NOT NULL,
  "package_type" text NOT NULL,
  "points_received" integer NOT NULL,
  "bonus_points" integer DEFAULT 0 NOT NULL,
  "is_claimed" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "pity_counter" (
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "pool_id" text NOT NULL,
  "pull_count" integer DEFAULT 0 NOT NULL,
  "last_reset" date DEFAULT CURRENT_DATE,
  PRIMARY KEY ("user_id", "pool_id")
);

ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "exp" integer DEFAULT 0 NOT NULL;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "last_feed_time" timestamp;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "evolution_stage" integer DEFAULT 0 NOT NULL;
