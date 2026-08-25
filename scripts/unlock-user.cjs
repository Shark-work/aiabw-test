// 解锁被锁定的账号：node scripts/unlock-user.cjs <邮箱>
// 清除 users.locked_until，恢复登录（用于误锁 / 客诉解锁）。
const fs = require("fs");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(".env", "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    console.error("Usage: node scripts/unlock-user.cjs <邮箱>");
    process.exit(1);
  }
  const r = await pool.query(`UPDATE users SET locked_until = NULL WHERE email = $1 RETURNING email`, [email]);
  if (r.rows.length) {
    console.log("✅ 已解锁:", r.rows[0].email);
  } else {
    console.log("❌ 用户不存在:", email);
    process.exit(1);
  }
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
