// 新增管理员账号：node scripts/add-admin.cjs <邮箱> <密码>
// 邮箱不存在则插入新用户（role=admin）；已存在则提示（不会覆盖已有密码）。
// 密码使用与项目登录一致的 scrypt 哈希（v2$salt:hash）。
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
    console.error("Usage: node scripts/add-admin.cjs <邮箱> <密码(至少6位)>");
    process.exit(1);
  }
  const exists = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (exists.rows.length) {
    console.log("❌ 邮箱已存在（不会覆盖）：", email);
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const inviteCode = "AD" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const r = await pool.query(
    `INSERT INTO users (email, password_hash, role, invite_code)
     VALUES ($1, $2, 'admin', $3) RETURNING email, role`,
    [email, passwordHash, inviteCode],
  );
  console.log("✅ 已新增管理员:", r.rows[0].email, "| role =", r.rows[0].role);
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
