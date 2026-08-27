// 盲盒初始运营数据执行器：逐条执行 scripts/init-blindbox-pools.sql
// 用法: node scripts/_bx-init-pools.cjs
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, p) =>
  Promise.race([
    pool.query(sql, p),
    new Promise((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 30000)),
  ]);

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "init-blindbox-pools.sql"), "utf8");
  // 逐条执行（跳过 -- 注释行与空行；以分号结尾作为语句边界）
  const stmts = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

  for (const s of stmts) {
    await q(s);
    console.log("OK  ", s.slice(0, 64).replace(/\s+/g, " "));
  }

  const pools = await q(
    "SELECT id, price_cny, price_points, probabilities, is_active FROM blindbox_pools ORDER BY created_at",
  );
  console.log("POOLS:", JSON.stringify(pools.rows));
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
