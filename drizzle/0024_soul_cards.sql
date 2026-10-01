-- 0024_soul_cards.sql
-- Aibi Soul Card（AI 灵魂卡 / 动态角色卡）+ 链下模拟账本（平台升级 Phase 1，2026-09-30）
--
-- 核心设计（链上/链下职责划分）：
--  - chain_supply：链上视角的供应权威（单例行 id=1）。max_supply / total_minted /
--    total_burned / next_token_id 控制凭证总量与编号分配；Mint 增发、Burn 销毁
--    都通过原子 UPDATE ... WHERE total_minted < max_supply RETURNING 完成，
--    无需显式锁即可保证并发安全（耗尽时 rowCount=0 → 业务层报 SUPPLY_EXHAUSTED）。
--  - soul_cards：链下业务状态（名称/稀有度/元素/栖息地/AI 性格/成长状态），
--    与 pets 实例 1:1（pet_id UNIQUE，一只宠物终身只对应一张卡，销毁后也不可重铸，
--    保证凭证稀缺性与防刷）。token_id / certificate_no 全局唯一。
--  - chain_ledger：链下模拟账本（tx_hash 唯一），记录 mint/burn/transfer 全部
--    链上事件，payload 存 ERC-721 标准 metadata 快照，供公开审计与后续真实
--    测试网（sepolia）对账。接真链时由 EvmChainProvider 写入真实 tx_hash。
--  - 不改 pets 原表任何列；销毁灵魂卡不影响宠物本身（业务与凭证分离）。

CREATE TABLE IF NOT EXISTS "soul_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pet_id" text NOT NULL REFERENCES "pets"("id"),
  "owner_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "rarity" text NOT NULL,
  "element" text NOT NULL,
  "habitat" text,
  "ai_personality" jsonb DEFAULT '{}' NOT NULL,
  "growth_stage" text DEFAULT 'seed' NOT NULL,
  "growth_level" integer DEFAULT 1 NOT NULL,
  "growth_exp" integer DEFAULT 0 NOT NULL,
  "token_id" bigint NOT NULL,
  "certificate_no" text NOT NULL,
  "mint_tx" text,
  "burn_tx" text,
  "status" text DEFAULT 'active' NOT NULL,
  "minted_at" timestamp DEFAULT now() NOT NULL,
  "burned_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "soul_cards_pet_unique" UNIQUE ("pet_id"),
  CONSTRAINT "soul_cards_token_id_unique" UNIQUE ("token_id"),
  CONSTRAINT "soul_cards_certificate_no_unique" UNIQUE ("certificate_no")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chain_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tx_hash" text NOT NULL,
  "tx_type" text NOT NULL,
  "token_id" bigint NOT NULL,
  "from_address" text,
  "to_address" text,
  "soul_card_id" uuid REFERENCES "soul_cards"("id"),
  "payload" jsonb DEFAULT '{}' NOT NULL,
  "block_number" bigint NOT NULL,
  "status" text DEFAULT 'confirmed' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "chain_ledger_tx_hash_unique" UNIQUE ("tx_hash")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chain_supply" (
  "id" integer PRIMARY KEY,
  "max_supply" integer DEFAULT 100000 NOT NULL,
  "total_minted" integer DEFAULT 0 NOT NULL,
  "total_burned" integer DEFAULT 0 NOT NULL,
  "next_token_id" bigint DEFAULT 1 NOT NULL,
  "next_block_number" bigint DEFAULT 1000000 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 供应单例（id 固定为 1，幂等种子）
INSERT INTO "chain_supply" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_soul_cards_owner" ON "soul_cards" ("owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_soul_cards_status" ON "soul_cards" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_soul_cards_rarity" ON "soul_cards" ("rarity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chain_ledger_token" ON "chain_ledger" ("token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chain_ledger_card" ON "chain_ledger" ("soul_card_id");
--> statement-breakpoint

COMMENT ON COLUMN soul_cards.token_id IS '链上 tokenId（模拟链全局单调递增，来自 chain_supply.next_token_id）';
COMMENT ON COLUMN soul_cards.certificate_no IS '链上凭证编号 AIBI-000001（由 token_id 派生，全局唯一）';
COMMENT ON COLUMN soul_cards.status IS 'active=流通中; burned=已销毁（不可逆）';
COMMENT ON COLUMN chain_supply.next_block_number IS '模拟链区块高度计数器（接真链后由真实区块号替代）';
