/**
 * 目录种子手动重导脚本（平台升级 Phase 3，2026-09-30）
 *
 * 用法（重新导入命令）：
 *   npm run seed:aibi
 *   （等价：node --experimental-loader ./tests/_paths-loader.mjs scripts/seed-aibi-catalog.ts；
 *    loader 负责解析 @/ 别名与无扩展相对导入，与测试同一解析链）
 *
 * 说明：
 *  - 数据单一来源 src/lib/aibi-catalog.ts；SQL 由 src/db/aibi-catalog-seed.ts 生成，
 *    全部为 INSERT ... ON CONFLICT ("id") DO UPDATE —— 可反复执行，不重复、可刷新修订。
 *  - 正常部署无需手动执行：client.ts 版本闸门（SCHEMA_VERSION=9）冷启动自动同步；
 *    本脚本用于：修订目录数据后免发版热刷新 / 新环境一次性灌入。
 *  - 连接：DATABASE_URL（环境变量 > .env.local > .env）。表需已存在
 *    （缺失时自动先跑建表 DDL，保证全新环境也可独立执行）。
 */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";
import { buildAibiCatalogSeedSql } from "../src/db/aibi-catalog-seed";

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^DATABASE_URL=["']?(.*?)["']?\s*$/m);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  throw new Error("DATABASE_URL 未找到（环境变量 / .env.local / .env 均无）");
}

/** 目录表 DDL（与 client.ts / drizzle/0026 内嵌一致的最小集，供全新环境兜底建表）。 */
const CATALOG_DDL = [
  `CREATE TABLE IF NOT EXISTS "aibi_rarities" (
    "id" text PRIMARY KEY, "name_zh" text NOT NULL, "name_en" text NOT NULL,
    "color" text NOT NULL, "multiplier" real NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "aibi_habitats" (
    "id" text PRIMARY KEY, "name_zh" text NOT NULL, "name_en" text NOT NULL,
    "element_affinity" text NOT NULL, "element_affinity_en" text NOT NULL,
    "description" text NOT NULL, "description_en" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "aibi_species" (
    "id" text PRIMARY KEY, "name_zh" text NOT NULL, "name_en" text NOT NULL,
    "rarity_id" text NOT NULL REFERENCES "aibi_rarities"("id"), "element" text NOT NULL,
    "habitat_id" text NOT NULL REFERENCES "aibi_habitats"("id"),
    "description" text NOT NULL, "description_en" text NOT NULL,
    "personality_template" text NOT NULL, "personality_template_en" text NOT NULL,
    "animation_level" integer DEFAULT 1 NOT NULL,
    "supports_3d" boolean DEFAULT false NOT NULL, "supports_chat" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "aibi_packs" (
    "id" text PRIMARY KEY, "name_zh" text NOT NULL, "name_en" text NOT NULL,
    "price_points" integer NOT NULL, "rarity_weights" jsonb NOT NULL, "allowed_rarities" jsonb NOT NULL,
    "animation_level" integer DEFAULT 1 NOT NULL, "status" text DEFAULT 'active' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "aibi_items" (
    "id" text PRIMARY KEY, "name_zh" text NOT NULL, "name_en" text NOT NULL,
    "item_type" text DEFAULT 'consumable' NOT NULL, "effect" text NOT NULL, "effect_en" text NOT NULL,
    "effect_payload" jsonb NOT NULL, "consume_mode" text DEFAULT 'immediate' NOT NULL,
    "affects_growth" boolean DEFAULT false NOT NULL, "affects_personality" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL)`,
];

/** Phase 4 前置列（drizzle/0027，v9）：须先于种子执行（items upsert 引用 price_points）。
 *  注意：仅含 aibi_items —— aibi_personalities 属 Phase 2 表（0025），
 *  其 growth 列与 aibi_token_seq 由 client.ts 版本闸门在 Phase 2 表就绪后同步，
 *  本脚本不假设该表存在（实测 v8 旧库报 relation does not exist）。 */
const PHASE4_ALTERS = [
  `ALTER TABLE "aibi_items" ADD COLUMN IF NOT EXISTS "price_points" integer DEFAULT 0 NOT NULL`,
];

/** 导入后的测试查询语句（执行完自动运行并打印结果）。 */
const VERIFY_QUERIES: Array<[string, string]> = [
  ["各表行数（应为 5/5/12/4/5）",
   `SELECT 'rarities' AS t, COUNT(*) FROM aibi_rarities UNION ALL
    SELECT 'habitats', COUNT(*) FROM aibi_habitats UNION ALL
    SELECT 'species', COUNT(*) FROM aibi_species UNION ALL
    SELECT 'packs', COUNT(*) FROM aibi_packs UNION ALL
    SELECT 'items', COUNT(*) FROM aibi_items ORDER BY 1`],
  ["物种 × 稀有度 × 栖息地（关联完整性抽查）",
   `SELECT s.id, s.name_zh, r.name_zh AS rarity, h.name_zh AS habitat, s.animation_level, s.supports_3d, s.supports_chat
    FROM aibi_species s JOIN aibi_rarities r ON r.id = s.rarity_id JOIN aibi_habitats h ON h.id = s.habitat_id
    ORDER BY r.sort_order, s.id`],
  ["卡包概率合计（每个应为 100）",
   `SELECT id, name_zh, price_points,
      (SELECT SUM(value::int) FROM jsonb_each_text(rarity_weights)) AS weight_sum, animation_level
    FROM aibi_packs ORDER BY price_points`],
];

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();
  const seeds = buildAibiCatalogSeedSql();
  try {
    for (const ddl of CATALOG_DDL) await client.query(ddl);
    for (const alter of PHASE4_ALTERS) await client.query(alter);
    await client.query("BEGIN");
    for (const sql of seeds) await client.query(sql);
    await client.query("COMMIT");
    console.log(`✓ 目录种子导入完成：${seeds.length} 行 upsert（rarities 5 / habitats 5 / species 12 / packs 4 / items 5）\n`);
    for (const [title, sql] of VERIFY_QUERIES) {
      const res = await client.query(sql);
      console.log(`-- ${title}`);
      console.table(res.rows);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("✗ 种子导入失败（已回滚）：", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
