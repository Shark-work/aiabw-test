// Live verification of the single-pet rule against https://www.aiabw.com
// 1) register -> adopt#1 ok -> adopt#2 blocked(402) -> gacha blocked(402)
// 2) simulate payment (set is_unlocked) -> adopt again ok
// 3) parallel adopts for a fresh user -> at most 1 pet
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";

async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(BASE + apiPath, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  } finally { clearTimeout(t); }
}

const results = [];
function ok(cond, label, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  [" + extra + "]" : ""));
  results.push(cond);
}

(async () => {
  const ts = Date.now().toString().slice(-7);
  const email = `limitchk_${ts}@test.aiabw`;
  const pool = new Pool({ connectionString: DATABASE_URL });

  // 1) register + adopt#1
  let r = await req("POST", "/api/auth/register", { email, password: "perfpass123" });
  ok(r.status === 200 && r.json?.ok, "register", "status=" + r.status);
  const token = r.json?.token;

  r = await req("POST", "/api/adopt", { petType: "fox" }, token);
  const pet1Id = r.json?.adoption?.id;
  ok(r.status === 200 && r.json?.ok === true && !!pet1Id, "adopt #1 ok", "pet1=" + pet1Id);

  // 2) second adopt must be blocked with payment hint
  r = await req("POST", "/api/adopt", { petType: "dog" }, token);
  ok(
    r.status === 402 && r.json?.code === "PET_LIMIT_REACHED" && r.json?.needPayment === true,
    "adopt #2 blocked (402 + payment hint)",
    "unlockAdoptionId=" + r.json?.unlockAdoptionId,
  );
  ok(r.json?.unlockAdoptionId === pet1Id, "unlockAdoptionId points to existing pet");

  // 3) gacha also blocked (needs points to pass the deduction step; then pet-limit blocks)
  await pool.query("UPDATE users SET points = 200 WHERE email = $1", [email]);
  r = await req("POST", "/api/gacha/draw", {}, token);
  ok(
    r.status === 402 && r.json?.code === "PET_LIMIT_REACHED",
    "gacha blocked for non-paid user",
    "status=" + r.status,
  );

  // 4) simulate payment: unlock pet1 -> adopt again allowed
  await pool.query("UPDATE adoptions SET is_unlocked = true WHERE id = $1", [pet1Id]);
  r = await req("POST", "/api/adopt", { petType: "penguin" }, token);
  ok(r.status === 200 && r.json?.ok === true, "adopt after unlock allowed", "status=" + r.status);

  // 5) parallel adopt race for a fresh user -> at most 1 pet
  const email2 = `limitchk2_${ts}@test.aiabw`;
  r = await req("POST", "/api/auth/register", { email: email2, password: "perfpass123" });
  const token2 = r.json?.token;
  const parallel = await Promise.all([
    req("POST", "/api/adopt", { petType: "fox" }, token2),
    req("POST", "/api/adopt", { petType: "dog" }, token2),
    req("POST", "/api/adopt", { petType: "penguin" }, token2),
  ]);
  const okCount = parallel.filter((x) => x.status === 200 && x.json?.ok).length;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM adoptions WHERE user_id = (SELECT id::text FROM users WHERE email=$1)`,
    [email2],
  );
  ok(okCount === 1 && Number(rows[0].n) === 1, "parallel adopts -> exactly 1 pet", `ok=${okCount} dbCount=${rows[0].n}`);

  // cleanup test users
  await pool.query(
    `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'limitchk_%@test.aiabw'))`
  );
  await pool.query(`DELETE FROM adoptions WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'limitchk_%@test.aiabw')`);
  await pool.query(`DELETE FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'limitchk_%@test.aiabw')`);
  await pool.query(`DELETE FROM users WHERE email LIKE 'limitchk_%@test.aiabw'`);
  await pool.end();

  const passed = results.filter(Boolean).length;
  console.log("----------------------------------");
  console.log(`SUMMARY: ${passed}/${results.length} passed (live=${BASE})`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
