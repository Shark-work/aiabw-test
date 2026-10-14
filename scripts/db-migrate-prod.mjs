/**
 * 生产数据库 schema 迁移脚本（幂等，可重复执行）
 *
 * 与运行时同一条权威路径：调用 src/db/client.ts 的版本闸门
 * （ensureDbSchemaOnce → 原子认领 → 幂等 DDL 全量同步 + 目录种子 upsert）。
 * 真实执行全量同步时由 client.ts 输出：
 *   [db] schema synced to version N
 * 若库已在当前 SCHEMA_VERSION，走快速路径（1 次轻量查询），脚本提示 already synced。
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/db-migrate-prod.mjs
 * （脚本内建 ESM loader 自举：client.ts 的无后缀相对导入需 tests/_paths-loader.mjs
 *   补 .ts 后缀，进程内 register 免命令行参数；旧写法
 *   node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs 仍兼容）
 *
 * DATABASE_URL 解析顺序：
 *   process.env.DATABASE_URL → .env.production → .env.local → .env
 * 推荐显式传入（PowerShell 示例）：
 *   $env:DATABASE_URL="postgresql://...pooler..."; `
 *   node scripts/db-migrate-prod.mjs
 * 或用 Vercel CLI：vercel env pull .env.production 后直接运行本脚本。
 *
 * 退出码：0 = 已同步到当前 SCHEMA_VERSION 且全部校验通过；1 = 失败。
 */
import fs from "node:fs";
import { register } from "node:module";

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

// ── ESM loader 自举（修复裸跑 ERR_MODULE_NOT_FOUND，2026-10-17）──────────────
// src/db/client.ts 引用 './aibi-catalog-seed' 等无后缀相对导入，Node 原生 ESM
// 无法解析，需 tests/_paths-loader.mjs 的 resolve hook 补 .ts 后缀。
// 进程内 register（Node ≥20.6；对后续动态 import 生效），免 --experimental-loader；
// 已带 loader 启动时跳过，避免重复注册。
{
  const loaderUrl = new URL("../tests/_paths-loader.mjs", import.meta.url);
  const preloaded = process.execArgv.some((a) => a.includes("_paths-loader"));
  if (!preloaded && fs.existsSync(loaderUrl)) {
    register(loaderUrl, import.meta.url);
  }
}

// 版本闸门落点校验用：先从源码读 SCHEMA_VERSION（纯文件读取，先于 import 无副作用）
const clientSrc = fs.readFileSync(new URL("../src/db/client.ts", import.meta.url), "utf8");
const expected = Number(clientSrc.match(/const SCHEMA_VERSION = (\d+);/)?.[1] ?? 0);

let ensureDbSchemaOnce, pool;
try {
  ({ ensureDbSchemaOnce, pool } = await import("../src/db/client.ts"));
} catch (e) {
  if (e && (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "ERR_UNKNOWN_FILE_EXTENSION")) {
    console.error(
      "[migrate-prod] FAIL: 加载 src/db/client.ts 失败（无后缀相对导入需 paths loader 自举，疑似 loader 文件缺失或 Node < 20.6）。\n" +
        "  兼容回退命令：node --experimental-loader ./tests/_paths-loader.mjs scripts/db-migrate-prod.mjs",
    );
    process.exit(1);
  }
  throw e;
}

let ok = true;
const check = (label, pass, detail = "") => {
  console.log(`[migrate-prod] ${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
};

try {
  console.log(`[migrate-prod] running version gate (v6 → v${expected || "?"} full sync if needed)…`);
  await ensureDbSchemaOnce();

  // 1) 版本闸门落点（动态：与 src/db/client.ts 的 SCHEMA_VERSION 对齐，随版本迭代自动升级）
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
