// 艾比平台 Phase 2 · 契约测试（数据库迁移与新增表，2026-09-30）
// 覆盖：drizzle/0025 迁移（8 表/外键/索引/枚举注释/回滚段）+ schema.ts 导出与列映射
//      + client.ts 内嵌 DDL、索引、SCHEMA_VERSION=7 + Phase 1 兼容（旧表不动）
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/aibi-platform.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  aibiTokens,
  mintLogs,
  burnLogs,
  supplySnapshots,
  physicalAssets,
  aibiPersonalities,
  aibiGrowthLogs,
  userWallets,
  soulCards,
  chainLedger,
  chainSupply,
} from "../src/db/schema.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

const PHASE2_TABLES = [
  "aibi_tokens",
  "mint_logs",
  "burn_logs",
  "supply_snapshots",
  "physical_assets",
  "aibi_personalities",
  "aibi_growth_logs",
  "user_wallets",
];

const PHASE2_INDEXES = [
  "idx_aibi_tokens_owner",
  "idx_aibi_tokens_species",
  "idx_aibi_tokens_status",
  "idx_mint_logs_token",
  "idx_mint_logs_source",
  "idx_burn_logs_token",
  "idx_burn_logs_reason",
  "idx_supply_snapshots_created",
  "idx_aibi_growth_logs_token",
  "idx_user_wallets_user",
];

test("migration: drizzle/0025 creates 8 tables with FKs, unique constraints, indexes", () => {
  assert.ok(exists("drizzle/0025_aibi_platform.sql"), "migration file exists");
  const sql = read("drizzle/0025_aibi_platform.sql");
  for (const table of PHASE2_TABLES) {
    assert.ok(
      sql.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      `creates ${table}`,
    );
  }
  // 外键关系（文档执行要求）
  assert.ok(sql.includes('"owner_id" uuid REFERENCES "users"("id")'), "aibi_tokens.owner_id → users");
  assert.ok(sql.includes('"soul_card_id" uuid REFERENCES "soul_cards"("id")'), "aibi_tokens.soul_card_id → soul_cards（Phase 1 桥接）");
  const tokenFkCount = sql.split('REFERENCES "aibi_tokens"("aibi_token_id")').length - 1;
  assert.equal(tokenFkCount, 4, "mint_logs/burn_logs/personalities/growth_logs → aibi_tokens");
  // 唯一约束
  assert.ok(sql.includes('CONSTRAINT "aibi_tokens_token_id_unique" UNIQUE ("aibi_token_id")'), "aibi_token_id unique");
  assert.ok(sql.includes('CONSTRAINT "aibi_personalities_token_unique"'), "personalities 1:1 unique");
  assert.ok(sql.includes('CONSTRAINT "user_wallets_user_addr_unique" UNIQUE ("user_id", "wallet_address")'), "wallet 防重复绑定");
  // 索引
  for (const idx of PHASE2_INDEXES) {
    assert.ok(sql.includes(`"${idx}"`), `index ${idx}`);
  }
});

test("migration: doc-required columns + enum value comments + rollback section", () => {
  const sql = read("drizzle/0025_aibi_platform.sql");
  for (const col of [
    '"aibi_token_id" text NOT NULL',
    '"physical_bound" boolean DEFAULT false NOT NULL',
    '"physical_order_id" text',
    '"burn_reason" text',
    '"supply_after" integer NOT NULL',
    '"block_number" text',
    '"total_minted" integer NOT NULL',
    '"current_supply" integer NOT NULL',
    '"max_supply" integer',
    '"chain_block" text',
    '"total_stock" integer DEFAULT 0 NOT NULL',
    '"issued_count" integer DEFAULT 0 NOT NULL',
    '"redeemed_count" integer DEFAULT 0 NOT NULL',
    '"contract_limit" integer',
    '"personality_type" text NOT NULL',
    '"affinity" integer DEFAULT 0 NOT NULL',
    '"energy" integer DEFAULT 100 NOT NULL',
    '"last_interacted_at" timestamp',
    '"action_type" text NOT NULL',
    '"before_state" jsonb',
    '"after_state" jsonb',
    '"wallet_address" text NOT NULL',
    '"is_primary" boolean DEFAULT false NOT NULL',
  ]) {
    assert.ok(sql.includes(col), `column: ${col}`);
  }
  // 枚举值以 COMMENT 形式存档
  assert.ok(sql.includes("pending=待铸造"), "status enum comment");
  assert.ok(sql.includes("pack_open=开卡包"), "source enum comment");
  assert.ok(sql.includes("physical_redeem=实物兑换"), "reason enum comment");
  // 回滚方案存在且全部被注释（无可执行 DROP）
  assert.ok(sql.includes("回滚方案"), "rollback section");
  assert.ok(!/^DROP TABLE /m.test(sql), "no executable DROP TABLE");
  assert.ok(!/^ALTER TABLE "(soul_cards|chain_ledger|chain_supply|users|pets)"/m.test(sql), "no ALTER on pre-existing tables");
});

test("schema.ts: 8 new pgTable exports with correct physical columns", () => {
  const tables = [
    [aibiTokens, "aibi_tokens"],
    [mintLogs, "mint_logs"],
    [burnLogs, "burn_logs"],
    [supplySnapshots, "supply_snapshots"],
    [physicalAssets, "physical_assets"],
    [aibiPersonalities, "aibi_personalities"],
    [aibiGrowthLogs, "aibi_growth_logs"],
    [userWallets, "user_wallets"],
  ];
  for (const [table, name] of tables) {
    assert.ok(table, `${name} exported`);
  }
  // 关键列物理名映射
  assert.equal(aibiTokens.aibiTokenId.name, "aibi_token_id");
  assert.equal(aibiTokens.physicalBound.name, "physical_bound");
  assert.equal(aibiTokens.soulCardId.name, "soul_card_id");
  assert.equal(mintLogs.supplyAfter.name, "supply_after");
  assert.equal(burnLogs.fromUserId.name, "from_user_id");
  assert.equal(supplySnapshots.chainBlock.name, "chain_block");
  assert.equal(physicalAssets.contractLimit.name, "contract_limit");
  assert.equal(aibiPersonalities.lastInteractedAt.name, "last_interacted_at");
  assert.equal(aibiGrowthLogs.actionType.name, "action_type");
  assert.equal(userWallets.isPrimary.name, "is_primary");
  // drizzle 层枚举（写路径类型约束）
  assert.deepEqual(aibiTokens.status.enumValues, ["pending", "minted", "burned", "revoked"]);
  assert.deepEqual(mintLogs.source.enumValues, ["pack_open", "event_reward", "fusion_generate", "admin_mint", "physical_claim"]);
  assert.deepEqual(burnLogs.reason.enumValues, ["fusion_consume", "item_consume", "user_burn", "expired_burn", "physical_redeem"]);
  assert.deepEqual(aibiGrowthLogs.actionType.enumValues, ["feed", "train", "talk", "play", "evolve"]);
});

test("compat: Phase 1 tables intact, migration 0024 untouched", () => {
  // schema.ts 旧导出仍在且关键列未变
  assert.equal(soulCards.tokenId.name, "token_id");
  assert.equal(soulCards.certificateNo.name, "certificate_no");
  assert.equal(chainLedger.txHash.name, "tx_hash");
  assert.equal(chainSupply.nextTokenId.name, "next_token_id");
  // 0024 迁移文件未被改动（仍包含三表 CREATE，且无 Phase 2 表）
  const sql24 = read("drizzle/0024_soul_cards.sql");
  assert.ok(sql24.includes('CREATE TABLE IF NOT EXISTS "soul_cards"'), "0024 intact");
  assert.ok(!sql24.includes("aibi_tokens"), "0024 not polluted");
});

test("client.ts: v7 changelog anchor + embedded DDL + indexes registered", () => {
  const client = read("src/db/client.ts");
  // 锚定 v7 changelog 注释而非 SCHEMA_VERSION 字面量（版本号会随后续 Phase 继续递增）
  assert.ok(client.includes("v7: 艾比平台 Phase 2"), "v7 changelog comment");
  for (const table of PHASE2_TABLES) {
    assert.ok(
      client.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      `embedded DDL: ${table}`,
    );
  }
  for (const idx of PHASE2_INDEXES) {
    assert.ok(client.includes(`"${idx}"`), `embedded index: ${idx}`);
  }
  // 版本闸门注释里的维护规则仍在（防止误删机制说明）
  assert.ok(client.includes("必须将 SCHEMA_VERSION +1"), "version-gate rule comment intact");
});
