-- 宠物旅行日记：探索地图 + 事件库 + 明信片
-- 设计原则：
--   1) adoptions 表加 exploration_steps / current_map_id / map_progress / weather 4 列
--      （IF NOT EXISTS 保证幂等；前缀 exploration_ 避免与未来 chat_steps 字段冲突）。
--   2) map_events 是事件库（只读种子数据，应用层按 map_id 抽取）。
--   3) user_postcards 记录每次完成地图生成的明信片（user_id+map_id+created_at 索引）。
--   4) user_items 已有 source 列；探索道具复用 user_items（source='exploration'），
--      item_key 在 src/lib/exploration-config.ts 列出。

-- 1) adoptions 扩展（聊天驱动挂机探索核心）
ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "exploration_steps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "current_map_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "map_progress" integer DEFAULT 0 NOT NULL;
ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "weather" text DEFAULT 'sunny' NOT NULL;

-- 2) 事件库（应用层 SELECT 抽取，不在 DB 端做随机）
CREATE TABLE IF NOT EXISTS "map_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "map_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "title_zh" text NOT NULL,
  "title_en" text NOT NULL,
  "description_zh" text NOT NULL,
  "description_en" text NOT NULL,
  "reward_item_key" text,
  "probability" double precision DEFAULT 0.6 NOT NULL,
  "weather_bias" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_map_events_map_id" ON "map_events" ("map_id");

-- 3) 明信片（完成地图后生成；用户主页 / 收藏展示）
CREATE TABLE IF NOT EXISTS "user_postcards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "adoption_id" uuid REFERENCES "adoptions"("id"),
  "map_id" integer NOT NULL,
  "map_name_zh" text NOT NULL,
  "map_name_en" text NOT NULL,
  "ai_summary_zh" text NOT NULL,
  "ai_summary_en" text NOT NULL,
  "illustration_emoji" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_postcards_user" ON "user_postcards" ("user_id", "created_at" DESC);
