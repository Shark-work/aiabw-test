-- 宠物旅行日记 · VIP 订阅系统迁移（drizzle/0018_subscription.sql）
-- 幂等：与 drizzle/0017_shop.sql 风格一致，可在已存在表上重复执行。
--
--  1) chat_quotas         每日聊天额度（user_id + date 唯一）
--  2) subscription_plans  订阅档位（月/季/年）
--  3) user_subscriptions  用户订阅实例（含到期/续费状态）
--  4) idx_chat_quotas_user_date   额度按用户+日期索引
--  5) idx_user_subscriptions_user 订阅按用户索引
--  6) uq_chat_quotas_user_date    (user_id,date) 唯一索引：/api/chat 计数
--     UPSERT 的 ON CONFLICT (user_id, date) 依赖它（缺了会报 42P10）
--
-- 注意：user_id 列类型与 src/db/client.ts 运行时 DDL 保持一致（uuid，
-- 对齐 users.id）。CREATE TABLE IF NOT EXISTS 不会修改已存在表的列类型，
-- 生产库以 client.ts 首次建表的结果为准。

CREATE TABLE IF NOT EXISTS "chat_quotas" (
  "id"              text PRIMARY KEY,
  "user_id"         uuid NOT NULL REFERENCES "users"("id"),
  "date"            text NOT NULL,
  "message_count"   integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamp
);

CREATE TABLE IF NOT EXISTS "subscription_plans" (
  "id"               text PRIMARY KEY,
  "name_zh"          text NOT NULL,
  "name_en"          text NOT NULL,
  "price_rmb"        integer NOT NULL,
  "duration_days"    integer NOT NULL,
  "daily_chat_limit" integer NOT NULL,
  "features"         jsonb NOT NULL DEFAULT '[]',
  "badge_zh"         text NOT NULL DEFAULT '',
  "badge_en"         text NOT NULL DEFAULT '',
  "sort_order"       integer NOT NULL DEFAULT 0,
  "is_active"        boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_subscriptions" (
  "id"           text PRIMARY KEY,
  "user_id"      uuid NOT NULL REFERENCES "users"("id"),
  "plan_id"      text NOT NULL REFERENCES "subscription_plans"("id"),
  "status"       text NOT NULL DEFAULT 'active',
  "started_at"   timestamp NOT NULL DEFAULT now(),
  "expires_at"   timestamp NOT NULL,
  "payment_id"   text,
  "auto_renew"   boolean DEFAULT true NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS "idx_chat_quotas_user_date" ON "chat_quotas" ("user_id", "date");
-- 唯一约束：/api/chat 与 /api/chat/quota 的 ON CONFLICT (user_id, date) 依赖
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chat_quotas_user_date" ON "chat_quotas" ("user_id", "date");
CREATE INDEX IF NOT EXISTS "idx_user_subscriptions_user" ON "user_subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_subscriptions_expires" ON "user_subscriptions" ("expires_at");

-- 3 档订阅种子（与 src/lib/subscription-config.ts 保持一致）
INSERT INTO "subscription_plans" ("id", "name_zh", "name_en", "price_rmb", "duration_days", "daily_chat_limit", "features", "badge_zh", "badge_en", "sort_order", "is_active") VALUES
  ('monthly',    '月卡',  'Monthly',   1990,  30,  -1, '["unlimitedChat","memoryAccess","rareEquipment","exploreBoost","rareEventBoost","adFree","vipBadge","prioritySupport"]'::jsonb, '',                  '',                    1, true),
  ('quarterly',  '季卡',  'Quarterly', 4990,  90,  -1, '["unlimitedChat","memoryAccess","rareEquipment","exploreBoost","rareEventBoost","adFree","vipBadge","prioritySupport"]'::jsonb, '省17%',              'Save 17%',            2, true),
  ('yearly',     '年卡',  'Yearly',    12800, 365, -1, '["unlimitedChat","memoryAccess","rareEquipment","exploreBoost","rareEventBoost","adFree","vipBadge","prioritySupport"]'::jsonb, '最划算·省48%',       'Best Value·Save 48%', 3, true)
ON CONFLICT ("id") DO NOTHING;
