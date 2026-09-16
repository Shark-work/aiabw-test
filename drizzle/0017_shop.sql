-- 宠物旅行日记 · P0 探险商城迁移（drizzle/0017_shop.sql）
-- 幂等：与 drizzle/0016_exploration.sql 风格一致，可在已存在表上重复执行。
--
--  1) shop_items  商品目录（永久装备 + 消耗品）
--     - id 语义化英文 key（tent / umbrella / compass / bridge / rope / lantern / hot_air_balloon）
--     - effect_type 形如 'obstacle_pass' / 'weather_resist' / 'distance_boost' / 'rare_event' / 'map_skip'
--     - effect_value 效果数值（如 distance_boost=1.5 表示步数 ×1.5）
--     - duration -1 = 永久；>0 = 消耗品（购买后 N 秒内生效，过期自动卸下，本期不实现过期逻辑）
--     - is_premium TRUE 表示仅高级公民月卡用户可购买
--     - currency 'coin' / 'rmb' / 'subscription'（本期只用 coin）
--  2) user_orders 用户购买订单（流水记录；同时 user_items 是真实背包）
--  3) users.coins  用户金币余额（默认 200，方便新用户体验基础装备）
--  4) idx_user_orders_user  加速“我的订单”查询

CREATE TABLE IF NOT EXISTS "shop_items" (
  "id"              text PRIMARY KEY,
  "name_zh"         text NOT NULL,
  "name_en"         text NOT NULL,
  "description_zh"  text NOT NULL,
  "description_en"  text NOT NULL,
  "icon"            text NOT NULL,
  "price"           integer NOT NULL,
  "currency"        text NOT NULL DEFAULT 'coin',
  "effect_type"     text NOT NULL,
  "effect_value"    double precision NOT NULL DEFAULT 1.0,
  "duration"        integer DEFAULT -1 NOT NULL,
  "is_premium"      boolean NOT NULL DEFAULT false,
  "sort_order"      integer NOT NULL DEFAULT 0,
  "is_active"       boolean NOT NULL DEFAULT true,
  "created_at"      timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_orders" (
  "id"            text PRIMARY KEY,
  "user_id"       uuid NOT NULL REFERENCES "users"("id"),
  "item_id"       text NOT NULL REFERENCES "shop_items"("id"),
  "quantity"      integer NOT NULL DEFAULT 1,
  "total_price"   integer NOT NULL,
  "currency"      text NOT NULL,
  "status"        text NOT NULL DEFAULT 'completed',
  "paid_at"       timestamp DEFAULT now() NOT NULL,
  "created_at"    timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_orders_user" ON "user_orders" ("user_id", "created_at" DESC);

-- 用户金币：默认 200（新用户体验基础装备足够）
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "coins" integer DEFAULT 200 NOT NULL;

-- 7 件种子商品（与 src/lib/shop-config.ts 的 SHOP_ITEMS 常量保持一致）
INSERT INTO "shop_items" ("id", "name_zh", "name_en", "description_zh", "description_en", "icon", "price", "currency", "effect_type", "effect_value", "duration", "is_premium", "sort_order") VALUES
  ('tent',            '露营帐篷',     'Camping Tent',       '在野外露营，不受恶劣天气影响',   'Camp outdoors, immune to bad weather',     '⛺', 100, 'coin', 'weather_resist', 1.0, -1, false, 1),
  ('umbrella',        '魔法雨伞',     'Magic Umbrella',     '下雨天也能继续探索，不会被淋湿', 'Keep exploring in rain without getting wet', '☂️', 50,  'coin', 'weather_resist', 1.0, -1, false, 2),
  ('compass',         '黄金指南针',   'Golden Compass',     '每次聊天多走 50% 的步数',         'Walk 50% more steps per chat message',     '🧭', 200, 'coin', 'distance_boost', 1.5, -1, false, 3),
  ('bridge',          '便携桥梁',     'Portable Bridge',    '自动通过河流障碍，无需等待',     'Auto-cross river obstacles instantly',    '🌉', 80,  'coin', 'obstacle_pass',  1.0, -1, false, 4),
  ('rope',            '攀岩绳索',     'Climbing Rope',      '自动通过陡坡障碍，无需等待',     'Auto-cross cliff obstacles instantly',    '🧗', 80,  'coin', 'obstacle_pass',  1.0, -1, false, 5),
  ('lantern',         '星空灯笼',     'Star Lantern',       '夜间探索触发稀有事件的概率翻倍', 'Double rare event chance during night',   '🏮', 300, 'coin', 'rare_event',     2.0, -1, true,  6),
  ('hot_air_balloon', '热气球',       'Hot Air Balloon',    '直接跳过当前地图，到达下一区域', 'Skip current map, jump to next region',   '🎈', 500, 'coin', 'map_skip',       1.0, -1, true,  7)
ON CONFLICT ("id") DO NOTHING;
