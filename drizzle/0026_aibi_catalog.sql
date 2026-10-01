-- 0026_aibi_catalog.sql
-- 艾比平台 Phase 3：目录表（稀有度/栖息地/物种/卡包/道具，2026-09-30）
--
-- 设计说明：
--  - 五张目录表承载指令集 3.1~3.5 种子数据；内容与业务表（aibi_tokens 等）解耦，
--    aibi_tokens.species_id / physical_assets.species_id 以 text 自由引用 aibi_species.id。
--  - 种子数据单一来源为 src/lib/aibi-catalog.ts；库内 upsert 由
--    src/db/aibi-catalog-seed.ts 生成（client.ts 版本闸门自动执行，或
--    npm run seed:aibi 手动重导），全部 ON CONFLICT DO UPDATE 幂等。
--  - 兼容原则不变：只新增，不改动任何现有表。

CREATE TABLE IF NOT EXISTS "aibi_rarities" (
  "id" text PRIMARY KEY,
  "name_zh" text NOT NULL,
  "name_en" text NOT NULL,
  "color" text NOT NULL,
  "multiplier" real NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "aibi_habitats" (
  "id" text PRIMARY KEY,
  "name_zh" text NOT NULL,
  "name_en" text NOT NULL,
  "element_affinity" text NOT NULL,
  "element_affinity_en" text NOT NULL,
  "description" text NOT NULL,
  "description_en" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "aibi_species" (
  "id" text PRIMARY KEY,
  "name_zh" text NOT NULL,
  "name_en" text NOT NULL,
  "rarity_id" text NOT NULL REFERENCES "aibi_rarities"("id"),
  "element" text NOT NULL,
  "habitat_id" text NOT NULL REFERENCES "aibi_habitats"("id"),
  "description" text NOT NULL,
  "description_en" text NOT NULL,
  "personality_template" text NOT NULL,
  "personality_template_en" text NOT NULL,
  "animation_level" integer DEFAULT 1 NOT NULL,
  "supports_3d" boolean DEFAULT false NOT NULL,
  "supports_chat" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "aibi_packs" (
  "id" text PRIMARY KEY,
  "name_zh" text NOT NULL,
  "name_en" text NOT NULL,
  "price_points" integer NOT NULL,
  "rarity_weights" jsonb NOT NULL,
  "allowed_rarities" jsonb NOT NULL,
  "animation_level" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "aibi_items" (
  "id" text PRIMARY KEY,
  "name_zh" text NOT NULL,
  "name_en" text NOT NULL,
  "item_type" text DEFAULT 'consumable' NOT NULL,
  "effect" text NOT NULL,
  "effect_en" text NOT NULL,
  "effect_payload" jsonb NOT NULL,
  "consume_mode" text DEFAULT 'immediate' NOT NULL,
  "affects_growth" boolean DEFAULT false NOT NULL,
  "affects_personality" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_aibi_species_rarity" ON "aibi_species" ("rarity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aibi_species_habitat" ON "aibi_species" ("habitat_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aibi_packs_status" ON "aibi_packs" ("status");
--> statement-breakpoint

COMMENT ON COLUMN aibi_packs.rarity_weights IS '稀有度抽取概率（百分比，合计 100）；starter 含 epic 10% 但 allowed_rarities 仅 common+rare，开包服务对范围外档位执行降级（文档勘误，见 src/lib/aibi-catalog.ts）';

-- 回滚方案（确认回退 Phase 3 时手动执行）：
--   DROP TABLE IF EXISTS "aibi_species";  -- 先删引用方
--   DROP TABLE IF EXISTS "aibi_rarities";
--   DROP TABLE IF EXISTS "aibi_habitats";
--   DROP TABLE IF EXISTS "aibi_packs";
--   DROP TABLE IF EXISTS "aibi_items";
--   UPDATE "_schema_meta" SET "version" = 7 WHERE "id" = 1;
--   并将 client.ts SCHEMA_VERSION 改回 7 后重新部署。
