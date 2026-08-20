const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

(async () => {
  const { rows } = await pool.query(
    `SELECT email, is_unlocked, points, created_at
       FROM users WHERE email LIKE '%@test.aiabw'
      ORDER BY created_at DESC LIMIT 8`,
  );
  for (const r of rows) {
    // 统计该账号的宠物数
    const pets = await pool.query(
      `SELECT count(*)::int AS n FROM adoptions WHERE user_id = (SELECT id::text FROM users WHERE email = $1)`,
      [r.email],
    );
    console.log(
      `${r.email} | unlocked=${r.is_unlocked} | points=${r.points} | pets=${pets.rows[0].n} | created=${r.created_at.toISOString().slice(0, 16)}`,
    );
  }
})().finally(() => pool.end());
