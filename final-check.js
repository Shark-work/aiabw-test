// After the user completes the real payment, check the DB unlock state.
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";
const email = process.argv[2];

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const q = await pool.query(
    `SELECT u.email, u.is_unlocked, u.points,
            (SELECT count(*)::int FROM adoptions a WHERE a.user_id = u.id::text) AS pet_count,
            (SELECT bool_or(a.is_unlocked) FROM adoptions a WHERE a.user_id = u.id::text) AS pet_unlocked
       FROM users u WHERE u.email = $1`,
    [email],
  );
  const row = q.rows[0];
  if (!row) {
    console.log("USER NOT FOUND:", email);
  } else {
    console.log("email        :", row.email);
    console.log("users.is_unlocked:", row.is_unlocked);
    console.log("pet_count    :", row.pet_count);
    console.log("any pet unlocked:", row.pet_unlocked);
    console.log("RESULT       :", row.is_unlocked === true ? "PAYMENT CLOSED THE LOOP ✅" : "not unlocked yet ⏳ (did you pay?)");
  }
  await pool.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
