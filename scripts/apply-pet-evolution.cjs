// Apply 0014_pets_evolution.sql to the live DB (idempotent).
// - strips comment lines, drops COMMENT ON statements (their body contains ';')
// - checks existing columns before ALTER (idempotent re-run)
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "drizzle", "0014_pets_evolution.sql"), "utf8");
  // 按行丢弃注释行与 COMMENT ON 行（后者正文含分号，逐行过滤最安全），再按分号切分
  const lines = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .filter((l) => !l.trim().toUpperCase().startsWith("COMMENT ON"));
  const stmts = lines.join("\n").split(";").map((s) => s.trim()).filter(Boolean);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='pets' AND column_name IN ('status','evolution_id')`,
  );
  const have = new Set(cols.rows.map((r) => r.column_name));

  for (const s of stmts) {
    // 幂等：列已存在则跳过对应 ADD COLUMN
    if (/\bADD COLUMN (status|evolution_id)\b/i.test(s)) {
      const name = s.match(/ADD COLUMN (\w+)/i)[1];
      if (have.has(name)) {
        console.log("skip (exists):", name);
        continue;
      }
    }
    await pool.query(s);
    console.log("OK:", s.slice(0, 90));
  }
  const check = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name='pets' AND column_name IN ('status','evolution_id') ORDER BY column_name`,
  );
  console.log("columns:", JSON.stringify(check.rows));
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename='pets' AND indexname='idx_pets_owner_active'`,
  );
  console.log("index:", JSON.stringify(idx.rows));
  await pool.end();
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
