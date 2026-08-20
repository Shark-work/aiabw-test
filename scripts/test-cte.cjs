// Test the atomic assignment CTE against the live DB.
const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

(async () => {
  // 用 qapay_6969222 的 user id
  const { rows: users } = await pool.query(`SELECT id FROM users WHERE email=$1 LIMIT 1`, ["qapay_6969222@test.aiabw"]);
  const uid = users[0]?.id;
  console.log("user=" + uid);
  try {
    const { rows } = await pool.query(
      `WITH chosen AS (
         SELECT id FROM pets
          WHERE owner_id IS NULL
          ORDER BY random()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE pets p
          SET owner_id = $1, adopted_at = now()
         FROM chosen c
        WHERE p.id = c.id
        RETURNING p.id, p.species_id, p.traits, p.generation`,
      [uid],
    );
    console.log("rows=" + JSON.stringify(rows));
  } catch (e) {
    console.log("CTE ERROR: " + e.message);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
