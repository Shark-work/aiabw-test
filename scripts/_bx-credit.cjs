// 测试账号积分充值（事务 + points_log 审计）
// 用法: node scripts/_bx-credit.cjs [email] [amount]
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

(async () => {
  const email = process.argv[2] || "r98838@sina.com";
  const amount = Number(process.argv[3] || 1000);
  const { rows } = await pool.query("SELECT id, points FROM users WHERE email = $1", [email]);
  const u = rows[0];
  if (!u) {
    console.error("USER_NOT_FOUND:", email);
    process.exit(2);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET points = points + $1 WHERE id = $2", [amount, u.id]);
    await client.query("INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, $3)", [
      u.id,
      amount,
      "盲盒测试运营充值",
    ]);
    await client.query("COMMIT");
    const after = await pool.query("SELECT points FROM users WHERE id = $1", [u.id]);
    console.log(`CREDITED +${amount} -> ${email}: ${u.points} -> ${after.rows[0].points}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
