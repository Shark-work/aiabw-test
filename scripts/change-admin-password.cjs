// 修改管理员密码：node scripts/change-admin-password.cjs <邮箱> <新密码>
// 密码使用与项目登录一致的 scrypt 哈希（v2$salt:hash），保证登录兼容。
const fs = require("fs");
const crypto = require("crypto");
const { promisify } = require("util");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(".env", "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

const SCRYPT_N = 8192;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const V2_PREFIX = "v2$";
const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${V2_PREFIX}${salt}:${hash.toString("hex")}`;
}

(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const password = process.argv[3] || "";
  if (!email || password.length < 6) {
    console.error("Usage: node scripts/change-admin-password.cjs <邮箱> <新密码(至少6位)>");
    process.exit(1);
  }
  const user = await pool.query(`SELECT id, role FROM users WHERE email = $1`, [email]);
  if (!user.rows.length) {
    console.log("❌ 用户不存在:", email);
    process.exit(1);
  }
  if (user.rows[0].role !== "admin") {
    console.log("❌ 该用户不是管理员（role != admin）:", email);
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, user.rows[0].id]);
  console.log("✅ 管理员", email, "的密码已更新");
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
