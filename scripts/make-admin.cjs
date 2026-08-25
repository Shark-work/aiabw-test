// 设置用户为站长（role=admin）：
// Usage: node scripts/make-admin.cjs <email>
const fs = require("fs");
const { Pool } = require("@neondatabase/serverless");
const env = fs.readFileSync(".env", "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/make-admin.cjs <email>");
  process.exit(1);
}

(async () => {
  const r = await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1 RETURNING email, role`, [email]);
  if (r.rows.length) {
    console.log("✅", r.rows[0].email, "→", r.rows[0].role);
  } else {
    console.log("❌ user not found:", email);
    process.exit(1);
  }
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
