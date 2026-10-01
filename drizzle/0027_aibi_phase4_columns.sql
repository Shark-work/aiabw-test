-- 0027_aibi_phase4_columns.sql
-- 艾比平台 Phase 4 前置列补全（2026-09-30）：
--  1) aibi_items.price_points —— 文档 3.5 未给道具定价，但 4.2 /api/item/buy 需积分扣费；
--     价格补全于 src/lib/aibi-catalog.ts（energy_fruit 50 / affinity_candy 80 /
--     training_core 120 / evolution_stone 2000 / repair_chip 200，对齐 starter 卡包=100 梯度）。
--  2) aibi_personalities.growth_level / growth_exp —— 成长数值的当前权威
--     （成长日志 2.7 存前后快照；当前等级/经验需可查询列支撑道具与互动结算）。
--  3) aibi_token_seq —— AIBI-000001 风格编号的发号序列（并发安全，替代 count+1 竞态）。
-- 兼容原则：只新增，全部 IF NOT EXISTS / 带默认值，旧库平滑回填。

ALTER TABLE "aibi_items" ADD COLUMN IF NOT EXISTS "price_points" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "aibi_personalities" ADD COLUMN IF NOT EXISTS "growth_level" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "aibi_personalities" ADD COLUMN IF NOT EXISTS "growth_exp" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "aibi_token_seq" START 1;
--> statement-breakpoint

-- 回滚方案（确认回退时手动执行）：
--   ALTER TABLE "aibi_items" DROP COLUMN IF EXISTS "price_points";
--   ALTER TABLE "aibi_personalities" DROP COLUMN IF EXISTS "growth_level";
--   ALTER TABLE "aibi_personalities" DROP COLUMN IF EXISTS "growth_exp";
--   DROP SEQUENCE IF EXISTS "aibi_token_seq";
--   UPDATE "_schema_meta" SET "version" = 8 WHERE "id" = 1;
--   并将 client.ts SCHEMA_VERSION 改回 8 后重新部署。
