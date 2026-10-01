/**
 * dev 库修复脚本（2026-09-30，Phase 5 冒烟前置）：
 * dev 库（.env DATABASE_URL）处于半迁移态 —— 只有 0026 目录表（种子脚本所建），
 * 缺 0025 核心表（aibi_tokens/mint_logs/...）与 0027 列/序列，且版本闸门
 * 认领实例疑似中断（错误被 ensureDbSchemaOnce 吞掉，请求放行后接口 500）。
 * 本脚本在独立进程中调用 client.ts 版本闸门（与运行时同一权威路径），
 * 完成后校验版本与关键对象，退出码 0/1。
 * 用法：node --experimental-loader ./tests/_paths-loader.mjs scripts/repair-aibi-db.mjs
 */
import fs from "node:fs";

for (const name of [".env.local", ".env"]) {
  if (process.env.DATABASE_URL?.trim()) break;
  if (!fs.existsSync(name)) continue;
  for (const line of fs.readFileSync(name, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
    if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "").trim();
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}

const { ensureDbSchemaOnce, pool } = await import("../src/db/client.ts");

let ok = true;
try {
  console.log("[repair] running ensureDbSchemaOnce (version gate full sync)…");
  await ensureDbSchemaOnce();

  const v = await pool.query(`SELECT "version" FROM "_schema_meta" WHERE "id" = 1`);
  const version = Number(v.rows[0]?.version ?? -999);
  console.log("[repair] _schema_meta version =", version);
  if (version < 9) {
    ok = false;
    console.error("[repair] FAIL: version < 9（同步未完成）");
  }

  const t = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE tablename IN ('aibi_tokens','mint_logs','burn_logs','supply_snapshots',
        'physical_assets','aibi_personalities','aibi_growth_logs','user_wallets',
        'aibi_rarities','aibi_habitats','aibi_species','aibi_packs','aibi_items')
      ORDER BY tablename`,
  );
  const names = t.rows.map((r) => r.tablename);
  console.log("[repair] aibi tables:", names.join(","));
  if (names.length < 13) {
    ok = false;
    console.error("[repair] FAIL: missing tables");
  }

  const seq = await pool.query(`SELECT 1 FROM pg_class WHERE relname = 'aibi_token_seq'`);
  console.log("[repair] aibi_token_seq exists:", seq.rows.length > 0);
  if (!seq.rows.length) ok = false;

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='aibi_personalities'`,
  );
  const has = (c) => cols.rows.some((r) => r.column_name === c);
  console.log("[repair] personalities growth cols:", has("growth_level"), has("growth_exp"));
  if (!has("growth_level") || !has("growth_exp")) ok = false;

  const packs = await pool.query(`SELECT count(*)::int c FROM aibi_packs`);
  console.log("[repair] aibi_packs rows:", packs.rows[0].c);
  if (packs.rows[0].c !== 4) ok = false;
} catch (e) {
  ok = false;
  console.error("[repair] crashed:", e);
} finally {
  await pool.end().catch(() => {});
}

console.log(ok ? "[repair] OK — dev DB at v9" : "[repair] FAILED");
process.exit(ok ? 0 : 1);
