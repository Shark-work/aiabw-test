-- 0025_aibi_platform.sql
-- 艾比平台升级 Phase 2：凭证/日志/快照/实物/性格/成长/钱包 八表（2026-09-30）
--
-- 设计说明（兼容原则：只新增、不改动/不删除任何现有表与数据）：
--  - aibi_tokens：新一代艾比链上凭证表。与 Phase 1 soul_cards 并存兼容——
--    soul_card_id 为可选桥接列（老灵魂卡可挂接新凭证体系），两体系编号均沿用
--    AIBI-000001 风格；owner_id / chain_id / contract_address / tx_hash 接真链后填充。
--  - mint_logs / burn_logs：增发/销毁日志（append-only），supply_after 记录
--    操作后总量快照值，block_number 按文档用 text（十进制字符串，兼容多链大数）。
--  - supply_snapshots：总量快照（定时/事件驱动写入，供 /supply 看板）。
--  - physical_assets：实物资产库存（issued/redeemed 计数，contract_limit 预留链上联动）。
--  - aibi_personalities：AI 性格档案（每凭证 1:1，UNIQUE aibi_token_id）。
--  - aibi_growth_logs：成长日志（feed/train/talk/play/evolve，前后状态 JSONB）。
--  - user_wallets：用户钱包绑定（UNIQUE(user_id, wallet_address) 防重复绑定）。
--  - 全部外键：owner/to_user/from_user/user_id → users(id)；日志/性格/成长 →
--    aibi_tokens(aibi_token_id)（唯一列）；aibi_tokens.soul_card_id → soul_cards(id)。

CREATE TABLE IF NOT EXISTS "aibi_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aibi_token_id" text NOT NULL,
  "species_id" text NOT NULL,
  "owner_id" uuid REFERENCES "users"("id"),
  "wallet_address" text,
  "chain_id" text,
  "contract_address" text,
  "tx_hash" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "minted_at" timestamp,
  "burned_at" timestamp,
  "burn_reason" text,
  "physical_bound" boolean DEFAULT false NOT NULL,
  "physical_order_id" text,
  "soul_card_id" uuid REFERENCES "soul_cards"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "aibi_tokens_token_id_unique" UNIQUE ("aibi_token_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mint_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aibi_token_id" text NOT NULL REFERENCES "aibi_tokens"("aibi_token_id"),
  "species_id" text NOT NULL,
  "to_user_id" uuid REFERENCES "users"("id"),
  "source" text NOT NULL,
  "chain_tx_hash" text,
  "block_number" text,
  "supply_after" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "burn_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aibi_token_id" text NOT NULL REFERENCES "aibi_tokens"("aibi_token_id"),
  "from_user_id" uuid REFERENCES "users"("id"),
  "reason" text NOT NULL,
  "chain_tx_hash" text,
  "block_number" text,
  "supply_after" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "supply_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "total_minted" integer NOT NULL,
  "total_burned" integer NOT NULL,
  "current_supply" integer NOT NULL,
  "max_supply" integer,
  "chain_block" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "physical_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "species_id" text,
  "total_stock" integer DEFAULT 0 NOT NULL,
  "issued_count" integer DEFAULT 0 NOT NULL,
  "redeemed_count" integer DEFAULT 0 NOT NULL,
  "contract_limit" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "aibi_personalities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aibi_token_id" text NOT NULL REFERENCES "aibi_tokens"("aibi_token_id"),
  "personality_type" text NOT NULL,
  "mood" text NOT NULL,
  "affinity" integer DEFAULT 0 NOT NULL,
  "energy" integer DEFAULT 100 NOT NULL,
  "last_interacted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "aibi_personalities_token_unique" UNIQUE ("aibi_token_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "aibi_growth_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aibi_token_id" text NOT NULL REFERENCES "aibi_tokens"("aibi_token_id"),
  "action_type" text NOT NULL,
  "before_state" jsonb,
  "after_state" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_wallets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "wallet_address" text NOT NULL,
  "chain_id" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_wallets_user_addr_unique" UNIQUE ("user_id", "wallet_address")
);
--> statement-breakpoint

-- 索引（文档要求 + 外键查询必需）
CREATE INDEX IF NOT EXISTS "idx_aibi_tokens_owner" ON "aibi_tokens" ("owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aibi_tokens_species" ON "aibi_tokens" ("species_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aibi_tokens_status" ON "aibi_tokens" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mint_logs_token" ON "mint_logs" ("aibi_token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mint_logs_source" ON "mint_logs" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_burn_logs_token" ON "burn_logs" ("aibi_token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_burn_logs_reason" ON "burn_logs" ("reason");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_supply_snapshots_created" ON "supply_snapshots" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aibi_growth_logs_token" ON "aibi_growth_logs" ("aibi_token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_wallets_user" ON "user_wallets" ("user_id");
--> statement-breakpoint

COMMENT ON COLUMN aibi_tokens.status IS 'pending=待铸造; minted=已铸造; burned=已销毁; revoked=已回收';
--> statement-breakpoint
COMMENT ON COLUMN mint_logs.source IS 'pack_open=开卡包; event_reward=活动奖励; fusion_generate=合成; admin_mint=后台增发; physical_claim=实物认领';
--> statement-breakpoint
COMMENT ON COLUMN burn_logs.reason IS 'fusion_consume=合成消耗; item_consume=道具消耗; user_burn=用户销毁; expired_burn=过期销毁; physical_redeem=实物兑换';
--> statement-breakpoint
COMMENT ON COLUMN aibi_tokens.soul_card_id IS 'Phase 1 灵魂卡桥接列（可选）：老卡挂接到新凭证体系';

-- ============================================================
-- 回滚方案（仅在确认整体回退 Phase 2 时手动执行；先删依赖方再删被引用方）：
--   DROP TABLE IF EXISTS "aibi_growth_logs";
--   DROP TABLE IF EXISTS "aibi_personalities";
--   DROP TABLE IF EXISTS "burn_logs";
--   DROP TABLE IF EXISTS "mint_logs";
--   DROP TABLE IF EXISTS "user_wallets";
--   DROP TABLE IF EXISTS "supply_snapshots";
--   DROP TABLE IF EXISTS "physical_assets";
--   DROP TABLE IF EXISTS "aibi_tokens";
--   UPDATE "_schema_meta" SET "version" = 6 WHERE "id" = 1;  -- 回退版本闸门
--   并将 client.ts SCHEMA_VERSION 改回 6 后重新部署。
-- 本迁移不影响 0024 及之前任何表与数据，回滚亦不动它们。
-- ============================================================

