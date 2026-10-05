/**
 * 生产数据库 schema 迁移脚本：v6 → v9（幂等，可重复执行）
 *
 * 与运行时同一条权威路径：调用 src/db/client.ts 的版本闸门
 * （ensureDbSchemaOnce → 原子认领 → 幂等 DDL 全量同步 + v8 目录种子 upsert）。
 * 真实执行全量同步时由 client.ts 输出：
 *   [db] schema synced to version 9
 * 若库已在 v9，走快速路径（1 次轻量查询），脚本提示 already synced。
 *
 * 用法（在仓库根目录执行）：
 *   node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs
 *
 * DATABASE_URL 解析顺序：
 *   process.env.DATABASE_URL → .env.production → .env.local → .env
 * 推荐显式传入（PowerShell 示例）：
 *   $env:DATABASE_URL="postgresql://...pooler..."; `
 *   node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs
 * 或用 Vercel CLI：vercel env pull .env.production 后直接运行本脚本。
 *
 * 退出码：0 = 已同步到 v9 且全部校验通过；1 = 失败。
 */
import fs from "node:fs";

for (const name of [".env.production", ".env.local", ".env"]) {
  if (process.env.DATABASE_URL?.trim()) break;
  if (!fs.existsSync(name)) continue;
  for (const line of fs.readFileSync(name, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
    if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "").trim();
  }
}
if (!process.env.DATABASE_URL) {
  console.error("[migrate-prod] FAIL: DATABASE_URL not found（env / .env.production / .env.local / .env）");
  process.exit(1);
}

const { ensureDbSchemaOnce, pool } = await import("../src/db/client.ts");

let ok = true;
const check = (label, pass, detail = "") => {
  console.log(`[migrate-prod] ${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
};

try {
  console.log("[migrate-prod] running version gate (v6 → v9 full sync if needed)…");
  await ensureDbSchemaOnce();

  // 1) 版本闸门落点（动态：与 src/db/client.ts 的 SCHEMA_VERSION 对齐，随版本迭代自动升级）
  const clientSrc = fs.readFileSync(new URL("../src/db/client.ts", import.meta.url), "utf8");
  const expected = Number(clientSrc.match(/const SCHEMA_VERSION = (\d+);/)?.[1] ?? 0);
  const v = await pool.query(`SELECT "version" FROM "_schema_meta" WHERE "id" = 1`);
  const version = Number(v.rows[0]?.version ?? -999);
  if (expected > 0 && version >= expected) {
    console.log(`[migrate-prod] ✅ _schema_meta version = ${version}（已同步到 v${expected}）`);
  } else {
    check(`_schema_meta version >= ${expected}`, false, `actual=${version}（-1=死锁，按 ops-rules 诊断三连排查后重跑本脚本）`);
  }

  // 2) v7 核心表（8）+ v8 目录表（5）
  const t = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE tablename IN ('aibi_tokens','mint_logs','burn_logs','supply_snapshots',
        'physical_assets','aibi_personalities','aibi_growth_logs','user_wallets',
        'aibi_rarities','aibi_habitats','aibi_species','aibi_packs','aibi_items')
      ORDER BY tablename`,
  );
  check("13 张艾比表（v7×8 + v8×5）", t.rows.length === 13, `${t.rows.length}/13`);

  // 3) v9 列与发号序列
  const seq = await pool.query(`SELECT 1 FROM pg_class WHERE relname = 'aibi_token_seq'`);
  check("aibi_token_seq 发号序列（v9）", seq.rows.length > 0);
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'aibi_personalities'`,
  );
  const has = (c) => cols.rows.some((r) => r.column_name === c);
  check("aibi_personalities 成长列 growth_level/growth_exp（v9）", has("growth_level") && has("growth_exp"));
  const itemCols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'aibi_items'`,
  );
  check("aibi_items.price_points 定价列（v9）", itemCols.rows.some((r) => r.column_name === "price_points"));

  // 4) v8 目录种子（31 行：5 稀有度 + 5 栖息地 + 12 物种 + 4 卡包 + 5 道具）
  const count = async (table) =>
    (await pool.query(`SELECT count(*)::int c FROM ${table}`)).rows[0].c;
  check("aibi_species 种子 = 12", (await count("aibi_species")) === 12, `actual=${await count("aibi_species")}`);
  check("aibi_packs 种子 = 4", (await count("aibi_packs")) === 4, `actual=${await count("aibi_packs")}`);
  check("aibi_items 种子 = 5", (await count("aibi_items")) === 5, `actual=${await count("aibi_items")}`);
  check("aibi_rarities 种子 ≥ 5", (await count("aibi_rarities")) >= 5, `actual=${await count("aibi_rarities")}`);
  check("aibi_habitats 种子 ≥ 5", (await count("aibi_habitats")) >= 5, `actual=${await count("aibi_habitats")}`);

  // 5) v19 变现基建（drizzle/0034）：3 新表 + pets 养成 4 列
  const t19 = await pool.query(
    `SELECT tablename FROM pg_tables WHERE tablename IN ('promoted_content','first_purchase','pity_counter')`,
  );
  check("v19 新表 ×3（promoted_content/first_purchase/pity_counter）", t19.rows.length === 3, `actual=${t19.rows.length}/3`);
  const petCols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='pets'`,
  );
  const hasPetCol = (c) => petCols.rows.some((r) => r.column_name === c);
  check(
    "pets 养成列 level/exp/last_feed_time/evolution_stage（v19）",
    ["level", "exp", "last_feed_time", "evolution_stage"].every(hasPetCol),
  );
} catch (e) {
  ok = false;
  console.error("[migrate-prod] crashed:", e);
} finally {
  await pool.end().catch(() => {});
}

console.log(ok ? "[migrate-prod] OK — production DB schema synced（版本以 _schema_meta 落点日志为准）" : "[migrate-prod] FAILED");
process.exit(ok ? 0 : 1);
