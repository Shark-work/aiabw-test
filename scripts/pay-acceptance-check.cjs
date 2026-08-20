// Step 4 of global-launch final acceptance - verify the REAL XorPay callback closed the loop.
// Usage: node scripts/pay-acceptance-check.cjs <email>
// Checks: 1) users.is_unlocked=true  2) that adoption is_unlocked=true
//         3) adopt #3 now ALLOWED (no more 402)  4) DB pay state
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";
const email = process.argv[2];
if (!email) { console.log("usage: node scripts/pay-acceptance-check.cjs <email>"); process.exit(2); }

async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(BASE + apiPath, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.is_unlocked,
            (SELECT count(*)::int FROM adoptions a WHERE a.user_id = u.id::text) AS pet_count,
            (SELECT bool_or(a.is_unlocked) FROM adoptions a WHERE a.user_id = u.id::text) AS any_pet_unlocked
       FROM users u WHERE u.email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row) { console.log("USER NOT FOUND:", email); await pool.end(); process.exit(1); }

  let payRowsText = "n/a";
  try {
    const payRows = await pool.query(
      `SELECT order_id, order_state, order_type, is_paid
         FROM pay_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [row.id],
    );
    payRowsText = JSON.stringify(payRows.rows);
  } catch {
    // pay_orders 表可能未创建（非必要）
  }
  console.log("email              :", row.email);
  console.log("users.is_unlocked  :", row.is_unlocked);
  console.log("pet_count          :", row.pet_count);
  console.log("any pet unlocked   :", row.any_pet_unlocked);
  console.log("pay_orders         :", payRowsText);

  // 登录 + 尝试领养第 3 只：解锁后必须放行（不再 402）
  const login = await req("POST", "/api/auth/login", { email, password: "realpaypass123" });
  const token = login.json?.token;
  if (!token) { console.log("login FAILED"); await pool.end(); process.exit(1); }
  const adopt3 = await req("POST", "/api/adopt", { petType: "cat" }, token);
  console.log("adopt #3 (after pay):", "status=" + adopt3.status + (adopt3.json?.ok ? " ALLOWED ✅ (unlock works)" : " " + JSON.stringify(adopt3.json).slice(0, 160)));
  console.log("pet_count now      :", (await pool.query(`SELECT count(*)::int AS n FROM adoptions WHERE user_id=(SELECT id::text FROM users WHERE email=$1)`, [email])).rows[0].n);

  const ok = row.is_unlocked === true && row.any_pet_unlocked === true && adopt3.status === 200 && adopt3.json?.ok;
  console.log("RESULT             :", ok ? "PAYMENT CLOSED THE LOOP ✅" : "not unlocked yet ⏳ (did the payment go through?)");
  await pool.end();
  process.exit(ok ? 0 : 3);
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
