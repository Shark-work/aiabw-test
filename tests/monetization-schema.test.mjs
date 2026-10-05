// 产品升级 Phase 1（变现基建）数据层契约测试
// 覆盖：
//   1) schema.ts：promoted_content / first_purchase / pity_counter 三表导出
//      + pets 养成字段（level/exp/last_feed_time/evolution_stage）+ 复合主键
//   2) client.ts：SCHEMA_ALTERS 幂等 DDL（3 表 + 2 索引 + 4 补列）+ SCHEMA_VERSION >= 19
//   3) drizzle/0034_monetization.sql：迁移快照存在且全幂等
//   4) points_log.reason 无 CHECK 约束：新值域（first_purchase_bonus 等）无需 DDL
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/monetization-schema.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const exists = (p) => existsSync(p);

// === 1) schema.ts 表定义 ===
test("schema: promotedContent / firstPurchase / pityCounter 三表导出", () => {
  const schema = read("src/db/schema.ts");
  assert.ok(schema.includes("export const promotedContent = pgTable('promoted_content'"), "promoted_content table");
  assert.ok(schema.includes("export const firstPurchase = pgTable('first_purchase'"), "first_purchase table");
  assert.ok(schema.includes("export const pityCounter = pgTable('pity_counter'"), "pity_counter table");
  // first_purchase：user_id 主键（一人一行天然幂等）
  assert.match(schema, /first_purchase'[\s\S]*?userId: uuid\('user_id'\)\.primaryKey\(\)/, "first_purchase user_id PK");
  // pity_counter：复合主键 (user_id, pool_id)
  assert.match(schema, /primaryKey\(\{ columns: \[t\.userId, t\.poolId\] \}\)/, "pity_counter composite PK");
});

test("schema: pets 养成四字段（level/exp/lastFeedTime/evolutionStage）", () => {
  const schema = read("src/db/schema.ts");
  const petsBlock = schema.match(/export const pets = pgTable\('pets', \{[\s\S]*?\}\);/);
  assert.ok(petsBlock, "pets table defined");
  assert.match(petsBlock[0], /level: integer\('level'\)\.notNull\(\)\.default\(1\)/, "pets.level");
  assert.match(petsBlock[0], /exp: integer\('exp'\)\.notNull\(\)\.default\(0\)/, "pets.exp");
  assert.match(petsBlock[0], /lastFeedTime: timestamp\('last_feed_time'\)/, "pets.last_feed_time");
  assert.match(petsBlock[0], /evolutionStage: integer\('evolution_stage'\)\.notNull\(\)\.default\(0\)/, "pets.evolution_stage");
});

// === 2) client.ts 版本闸门 ===
test("client.ts: 0034 DDL/索引/补列注入 SCHEMA_ALTERS + SCHEMA_VERSION >= 19", () => {
  const client = read("src/db/client.ts");
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "promoted_content"'), "promoted_content DDL");
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "first_purchase"'), "first_purchase DDL");
  assert.ok(client.includes('CREATE TABLE IF NOT EXISTS "pity_counter"'), "pity_counter DDL");
  assert.ok(client.includes('CREATE INDEX IF NOT EXISTS "idx_promoted_content_type_time"'), "type+time index");
  assert.ok(client.includes('CREATE INDEX IF NOT EXISTS "idx_promoted_content_promoter"'), "promoter index");
  assert.ok(client.includes('ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL'), "pets.level alter");
  assert.ok(client.includes('ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "exp" integer DEFAULT 0 NOT NULL'), "pets.exp alter");
  assert.ok(client.includes('ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "last_feed_time" timestamp'), "pets.last_feed_time alter");
  assert.ok(client.includes('ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "evolution_stage" integer DEFAULT 0 NOT NULL'), "pets.evolution_stage alter");
  assert.ok(client.includes("v19: 产品升级 Phase 1 变现基建"), "v19 changelog comment");
  const v = Number(client.match(/const SCHEMA_VERSION = (\d+);/)?.[1]);
  assert.ok(v >= 19, `SCHEMA_VERSION 需 >=19（实际 ${v}），否则生产库不同步 0034 对象`);
});

// === 3) drizzle/0034 迁移快照 ===
test("drizzle/0034_monetization.sql: 存在且全幂等", () => {
  assert.ok(exists("drizzle/0034_monetization.sql"), "migration file exists");
  const sql = read("drizzle/0034_monetization.sql");
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "promoted_content"'), "idempotent promoted_content");
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "first_purchase"'), "idempotent first_purchase");
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "pity_counter"'), "idempotent pity_counter");
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS "idx_promoted_content_type_time"'), "idempotent index");
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS "level"'), "idempotent pets.level");
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS "evolution_stage"'), "idempotent pets.evolution_stage");
  // 破坏性语句红线：本迁移不得 DROP 任何既有对象
  assert.ok(!/DROP (TABLE|COLUMN)/i.test(sql), "no destructive DROP");
});

// === 4) points_log.reason 值域扩展无需 DDL ===
test("points_log.reason 为 text 无 CHECK：新值域 first_purchase_bonus 等由应用层写入", () => {
  const client = read("src/db/client.ts");
  const createBlock = client.match(/CREATE TABLE IF NOT EXISTS "points_log" \([\s\S]*?\)`,/);
  assert.ok(createBlock, "points_log CREATE exists");
  assert.ok(createBlock[0].includes('"reason" text NOT NULL'), "reason is plain text");
  assert.ok(!/reason[^)]*CHECK/i.test(createBlock[0]), "reason has no CHECK constraint");
  // 新值域在 v19 注释中登记（文档级约定，见 drizzle/0034 头部）
  assert.ok(client.includes("first_purchase_bonus"), "first_purchase_bonus registered");
  assert.ok(client.includes("promotion_purchase"), "promotion_purchase registered");
  assert.ok(client.includes("style_unlock"), "style_unlock registered");
  assert.ok(client.includes("pity_reward"), "pity_reward registered");
});
