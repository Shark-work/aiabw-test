-- 0033_seasonal_events.sql
-- P2 社交传播（2026-10-14）：季节活动骨架
--
--   seasonal_events        活动配置（slug 唯一；name/description 多语言 JSONB；
--                          start_at/end_at 时间窗；is_active 总开关；rewards JSONB 奖励定义）
--   user_seasonal_progress 用户活动进度（UNIQUE(user_id,event_id)；
--                          exploration_count / bond_crystals 活动期间累计；claimed 领奖标记）
--
-- 本次只搭框架：占位活动 slug='placeholder'（is_active=false）不外露；
-- 后续运营通过改配置（is_active=true + 时间窗 + rewards）开启活动，无需发版。
-- 活动结束后 is_active 置 false，进度行保留可查（参与记录），不再产出奖励。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING。

CREATE TABLE IF NOT EXISTS "seasonal_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" jsonb NOT NULL,
  "description" jsonb NOT NULL,
  "start_at" timestamp NOT NULL,
  "end_at" timestamp NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "rewards" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "seasonal_events_slug_unique" UNIQUE ("slug")
);

CREATE TABLE IF NOT EXISTS "user_seasonal_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "event_id" uuid NOT NULL REFERENCES "seasonal_events"("id"),
  "exploration_count" integer DEFAULT 0 NOT NULL,
  "bond_crystals" integer DEFAULT 0 NOT NULL,
  "claimed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_seasonal_progress_user_event_unique" UNIQUE ("user_id", "event_id")
);

-- 占位活动（关闭状态，骨架验证用；运营时改 is_active / 时间窗 / rewards 开启）
INSERT INTO "seasonal_events" ("slug", "name", "description", "start_at", "end_at", "is_active", "rewards")
VALUES (
  'placeholder',
  '{"zh":"占位活动","en":"Placeholder Event"}'::jsonb,
  '{"zh":"季节活动框架占位：后续运营活动时通过配置开启。","en":"Seasonal event framework placeholder. Future campaigns are enabled via config."}'::jsonb,
  now(),
  now() + interval '365 days',
  false,
  '{"points":100}'::jsonb
)
ON CONFLICT ("slug") DO NOTHING;
