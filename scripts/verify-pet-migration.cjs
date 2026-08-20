const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

(async () => {
  // 1) pet_dictionary 数量 + 分类分布
  const cat = await pool.query(`SELECT category, count(*)::int AS n FROM pet_dictionary GROUP BY category ORDER BY n DESC`);
  console.log("=== pet_dictionary categories ===");
  cat.rows.forEach((r) => console.log(`  ${r.category}: ${r.n}`));

  // 2) pets 表列
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='pets' ORDER BY ordinal_position`,
  );
  console.log("=== pets columns ===");
  cols.rows.forEach((r) => console.log(`  ${r.column_name} (${r.data_type}, null=${r.is_nullable})`));

  // 3) 索引
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename='pets' OR tablename='pet_dictionary' ORDER BY indexname`,
  );
  console.log("=== indexes ===");
  idx.rows.forEach((r) => console.log(`  ${r.indexname}`));

  // 4) 抽样一条雪豹
  const sp = await pool.query(
    `SELECT id, name_zh, habitat, default_description_zh FROM pet_dictionary WHERE id='snow_leopard'`,
  );
  console.log("=== sample ===");
  console.log("  " + JSON.stringify(sp.rows[0]));

  await pool.end();
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
