/**
 * 冒烟测试用户清理脚本（对应 docs/RELEASE_CHECKLIST.md 附录）。
 *
 * 目标：删除 smoke-full.mjs / smoke-production.mjs 产生的测试用户
 * （full-smoke-*@test.dev / prod-smoke-*@test.dev）及其全部关联数据。
 *
 * 设计要点：
 *  - 关联表自动发现（三层）：
 *      L1  FK 引用 users 的表 ∪ 含 user 语义列（user_id/owner_id 等）的表；
 *      L2+ 沿入向 FK BFS 扩展无 user 列的附属表（aibi_growth_logs 经 aibi_token_id、
 *          chain_ledger 经 soul_card_id、messages 经 thread_id 等），条件递归展开为
 *          嵌套子查询；带全局目录表黑名单 + 防环保护；
 *  - 混合类型安全：所有比较统一 ::text（uuid/text 均合法）；
 *  - 子表间依赖用 SAVEPOINT 重试队列消解（PG 事务内语句失败即 aborted，必须
 *    SAVEPOINT 才能继续），不假设 CASCADE；
 *  - pets 为预生成实例池：冒烟用户占有的实例释放回池（owner_id 置 NULL），不删行；
 *  - 单事务执行，任一失败整体 ROLLBACK；安全闸：仅匹配冒烟前缀邮箱。
 *
 * 用法（仓库根目录）：
 *   node scripts/cleanup-smoke-users.mjs            # dry-run：仅统计，不删除
 *   node scripts/cleanup-smoke-users.mjs --execute  # 事务性删除 + 前后对比
 *
 * DATABASE_URL 解析顺序：process.env.DATABASE_URL → .env.production → .env.local → .env
 * 退出码：0 = 成功；1 = 失败（已回滚）。
 */
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";

const EXECUTE = process.argv.includes("--execute");

for (const name of [".env.production", ".env.local", ".env"]) {
  if (process.env.DATABASE_URL?.trim()) break;
  if (!fs.existsSync(name)) continue;
  for (const line of fs.readFileSync(name, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
    if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "").trim();
  }
}
if (!process.env.DATABASE_URL) {
  console.error("[cleanup] FAIL: DATABASE_URL not found");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const out = (s = "") => console.log(s);

/** user 语义列（无 FK 的 text 列靠它兜底发现；同表多列取 OR） */
const USER_COLS = [
  "user_id", "owner_id", "inviter_id", "invited_user_id",
  "creator_id", "buyer_id", "to_user_id", "from_user_id",
];
/** 全局目录/配置表：BFS 扩展永不纳入（防误删共享数据） */
const GLOBAL_TABLES = new Set([
  "pet_dictionary", "pets", "animal_wiki", "exploration_events_v2",
  "blindbox_pools", "collectibles", "aibi_species", "aibi_packs",
  "cosmetics", "subscription_plans", "seasonal_events", "ugc_campaigns",
  "_schema_meta",
]);

try {
  // ── 1. 定位目标用户（安全闸：仅冒烟前缀）──────────────────────
  const { rows: targets } = await pool.query(
    `SELECT id::text AS id, email, created_at
       FROM users
      WHERE email LIKE 'full-smoke-%@test.dev'
         OR email LIKE 'prod-smoke-%@test.dev'
      ORDER BY created_at`,
  );
  if (targets.length === 0) {
    out("[cleanup] 无匹配的冒烟用户，无需清理。");
    process.exit(0);
  }
  const ids = targets.map((t) => t.id);
  out(`[cleanup] 目标用户 ${targets.length} 个：`);
  for (const t of targets) out(`  - ${t.email} (id=${t.id})`);

  // ── 2. L1 发现：FK 引用 users ∪ user 语义列 ──────────────────
  const { rows: fkRefs } = await pool.query(
    `SELECT DISTINCT tc.table_name AS tbl, kcu.column_name AS col
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_schema = 'public' AND ccu.table_name = 'users'
        AND tc.table_schema = 'public' AND tc.table_name <> 'users'`,
  );
  const { rows: semanticRefs } = await pool.query(
    `SELECT table_name AS tbl, column_name AS col
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> 'users'
        AND column_name = ANY($1::text[])`,
    [USER_COLS],
  );
  // tables: tbl → { type:'direct', cols:string[] } | { type:'via', parent, parentCol, childCol }
  const tables = new Map();
  const addDirect = (tbl, col) => {
    if (GLOBAL_TABLES.has(tbl)) return;
    if (!tables.has(tbl)) tables.set(tbl, { type: "direct", cols: [] });
    const info = tables.get(tbl);
    if (info.type === "direct" && !info.cols.includes(col)) info.cols.push(col);
  };
  for (const { tbl, col } of [...fkRefs, ...semanticRefs]) addDirect(tbl, col);

  // ── 3. L2+ 沿入向 FK BFS 扩展附属表 ─────────────────────────
  const bfsQueue = ["users", ...tables.keys()];
  const seen = new Set(bfsQueue);
  while (bfsQueue.length > 0) {
    if (seen.size > 60) throw new Error("BFS 扩展表数超限（防失控），中止");
    const parent = bfsQueue.shift();
    const { rows: inbound } = await pool.query(
      `SELECT DISTINCT tc.table_name AS child, kcu.column_name AS child_col,
              ccu.column_name AS parent_col
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_schema = 'public' AND ccu.table_name = $1
          AND tc.table_schema = 'public'`,
      [parent],
    );
    for (const r of inbound) {
      if (r.child === parent || seen.has(r.child) || GLOBAL_TABLES.has(r.child)) continue;
      seen.add(r.child);
      tables.set(r.child, { type: "via", parent, parentCol: r.parent_col, childCol: r.child_col });
      bfsQueue.push(r.child);
    }
  }

  // ── 4. 条件 / 语句生成（::text 统一比较，嵌套子查询展开）──────
  const condOf = (tbl) => {
    if (tbl === "users") return `id::text = ANY($1)`;
    const info = tables.get(tbl);
    if (info.type === "direct") {
      return info.cols.map((c) => `"${c}"::text = ANY($1)`).join(" OR ");
    }
    return `"${info.parentCol}"::text IN (SELECT "${info.parentCol}"::text FROM "${info.parent}" WHERE ${condOf(info.parent)})`;
  };
  const deleteSql = (tbl) => {
    if (tbl === "users") return `DELETE FROM users WHERE id::text = ANY($1)`;
    const info = tables.get(tbl);
    if (info.type === "direct") return `DELETE FROM "${tbl}" WHERE ${condOf(tbl)}`;
    return `DELETE FROM "${tbl}" WHERE "${info.childCol}"::text IN (SELECT "${info.parentCol}"::text FROM "${info.parent}" WHERE ${condOf(info.parent)})`;
  };
  const countSql = (tbl) => deleteSql(tbl).replace(/^DELETE FROM/, "SELECT COUNT(*)::int AS n FROM");

  // ── 5. 统计（清理前）─────────────────────────────────────────
  const allTables = [...tables.keys(), "users"];
  const counts = async () => {
    const r = new Map();
    for (const tbl of [...allTables].sort()) {
      const { rows } = await pool.query(countSql(tbl), [ids]);
      r.set(tbl, rows[0].n);
    }
    return r;
  };
  const before = await counts();

  // pets 特殊：预生成实例池，释放回池（UPDATE），不删行；单独统计展示
  const PETS_SQL = `UPDATE pets SET owner_id = NULL, adopted_at = NULL, guest_owner = NULL, custom_description = NULL, last_interaction_time = NULL WHERE owner_id::text = ANY($1)`;
  const petsCount = async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pets WHERE owner_id::text = ANY($1)`, [ids]);
    return rows[0].n;
  };
  const petsBefore = await petsCount();

  // ── 6. 删除（--execute 时；SAVEPOINT 重试队列消解依赖）────────
  let after = before;
  let petsAfter = petsBefore;
  if (EXECUTE) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pending = [{ label: "pets(release→pool)", sql: PETS_SQL }];
      for (const tbl of allTables) pending.push({ label: tbl, sql: deleteSql(tbl) });

      let rounds = 0;
      while (pending.length > 0) {
        if (++rounds > 12) throw new Error(`依赖无法消解，剩余表：${pending.map((p) => p.label).join(", ")}`);
        let progressed = false;
        for (let i = pending.length - 1; i >= 0; i--) {
          // PG 事务内语句失败会置整个事务为 aborted，必须 SAVEPOINT 才能继续重试
          try {
            await client.query("SAVEPOINT sp_task");
            await client.query(pending[i].sql, [ids]);
            await client.query("RELEASE SAVEPOINT sp_task");
            pending.splice(i, 1);
            progressed = true;
          } catch (e) {
            await client.query("ROLLBACK TO SAVEPOINT sp_task").catch(() => {});
            if (e.code !== "23503") throw e; // 仅 FK 违规（等待被引用方先处理）可重试
          }
        }
        if (!progressed) throw new Error(`依赖死循环，剩余表：${pending.map((p) => p.label).join(", ")}`);
      }
      await client.query("COMMIT");
      after = await counts();
      petsAfter = await petsCount();
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[cleanup] FAIL（已回滚）: ${e.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  // ── 7. 前后对比报告 ──────────────────────────────────────────
  const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  out(`\n[cleanup] ${EXECUTE ? "执行完成" : "DRY-RUN（未删除，加 --execute 执行）"}：`);
  out("| 表 | 清理前 | 清理后 |");
  out("| --- | ---: | ---: |");
  if (petsBefore > 0 || petsAfter > 0) {
    out(`| pets（释放回池，非删除） | ${petsBefore} | ${EXECUTE ? petsAfter : "—"} |`);
  }
  for (const tbl of [...before.keys()].sort()) {
    if (before.get(tbl) === 0 && after.get(tbl) === 0) continue; // 只列非空表
    out(`| ${tbl} | ${before.get(tbl)} | ${EXECUTE ? after.get(tbl) : "—"} |`);
  }
  out(`| **合计** | **${total(before)}** | **${EXECUTE ? total(after) : "—"}** |`);
  if (EXECUTE && (total(after) !== 0 || petsAfter !== 0)) {
    console.error("[cleanup] FAIL: 清理后仍有残留");
    process.exit(1);
  }
  out(EXECUTE ? "\nCLEANUP_OK" : "\nCLEANUP_DRY_RUN_OK");
} finally {
  await pool.end();
}
