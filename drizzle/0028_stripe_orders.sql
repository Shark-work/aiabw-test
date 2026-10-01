-- ============================================================
-- 0028_stripe_orders.sql — 艾比平台 Phase 11 · Stripe 支付订单表
--
-- 设计要点：
--  1) id = Stripe Checkout Session ID（cs_test_… / cs_live_…），天然幂等键；
--  2) status 流转：pending（create-checkout 落库）
--       → paid（webhook checkout.session.completed 履约，同事务发放权益）
--       → expired（checkout.session.expired 关闭待支付单）；
--  3) 权益恰好一次：webhook 事务内 SELECT ... FOR UPDATE + status='pending' 守卫；
--  4) points_amount：积分充值到账积分快照（创建时写入，履约不重算，防止配置漂移）；
--  5) amount_total / currency：webhook 回填实收（分 / 币种），用于对账。
--
-- 运行时同步：本表 DDL 已注入 src/db/client.ts SCHEMA_CREATES（SCHEMA_VERSION=10），
-- 生产库经版本闸门冷启动自动同步，无需手工执行本文件。
--
-- 回滚（仅在确需撤回 Phase 11 时）：
--   DROP TABLE IF EXISTS "stripe_orders";
--   UPDATE "_schema_meta" SET "version" = 9 WHERE "id" = 1;  -- 回退版本闸门
--   并将 client.ts SCHEMA_VERSION 改回 9 后重新部署。
-- 本迁移不影响 0027 及之前任何表与数据，回滚亦不动它们。
-- ============================================================

CREATE TABLE IF NOT EXISTS "stripe_orders" (
  "id"              text PRIMARY KEY,
  "user_id"         uuid NOT NULL REFERENCES "users"("id"),
  "product_type"    text NOT NULL,
  "product_id"      text,
  "quantity"        integer NOT NULL DEFAULT 1,
  "points_amount"   integer,
  "stripe_price_id" text NOT NULL,
  "amount_total"    integer,
  "currency"        text,
  "status"          text NOT NULL DEFAULT 'pending',
  "created_at"      timestamp DEFAULT now() NOT NULL,
  "paid_at"         timestamp
);

CREATE INDEX IF NOT EXISTS "idx_stripe_orders_user"
  ON "stripe_orders" ("user_id", "created_at" DESC);
