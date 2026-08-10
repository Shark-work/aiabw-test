// Live verification against https://www.aiabw.com
// A) single-pet rule (user-level global unlock):
//    adopt#1 ok -> adopt#2 blocked(402) -> gacha blocked(402) ->
//    simulate payment (users.is_unlocked=true) -> adopt again ok (unlimited)
// B) pay/create security: no auth -> 401; other user's adoptionId -> 403; own -> passes auth
// C) parallel adopts -> exactly 1 pet
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
  const emailA = `unlock_a_${ts}@test.aiabw`;
  const emailB = `unlock_b_${ts}@test.aiabw`;
  const emailC = `unlock_c_${ts}@test.aiabw`;
  const pool = new Pool({ connectionString: DATABASE_URL });

  // ---- user A: adopt#1 -> blocked#2 -> pay security -> unlocked -> unlimited ----
  let r = await req("POST", "/api/auth/register", { email: emailA, password: "perfpass123" });
  ok(r.status === 200 && r.json?.ok, "register A", "status=" + r.status);
  const tokenA = r.json?.token;

  r = await req("POST", "/api/adopt", { petType: "fox" }, tokenA);
  const petAId = r.json?.adoption?.id;
  ok(r.status === 200 && r.json?.ok === true && !!petAId, "A adopt #1 ok");

  r = await req("POST", "/api/adopt", { petType: "dog" }, tokenA);
  ok(
    r.status === 402 && r.json?.code === "PET_LIMIT_REACHED" && r.json?.needPayment === true,
    "A adopt #2 blocked (402)",
    "unlockAdoptionId=" + r.json?.unlockAdoptionId,
  );

  // ---- user B: pay/create security ----
  r = await req("POST", "/api/auth/register", { email: emailB, password: "perfpass123" });
  const tokenB = r.json?.token;
  ok(r.status === 200, "register B", "status=" + r.status);

  // no auth -> 401
  r = await req("POST", "/api/pay/create", { adoptionId: petAId, amount: 9.9 }, null);
  ok(r.status === 401, "pay/create without auth -> 401", "status=" + r.status);

  // B paying for A's pet -> 403
  r = await req("POST", "/api/pay/create", { adoptionId: petAId, amount: 9.9 }, tokenB);
  ok(r.status === 403, "pay/create with other user's adoption -> 403", "status=" + r.status);

  // A paying for own pet -> passes auth/ownership (may fail later on XorPay env, that's fine)
  r = await req("POST", "/api/pay/create", { adoptionId: petAId, amount: 9.9 }, tokenA);
  ok(r.status !== 401 && r.status !== 403, "pay/create with own adoption passes auth", "status=" + r.status);

  // gacha blocked for A (needs points to pass deduction first)
  await pool.query("UPDATE users SET points = 200 WHERE email = $1", [emailA]);
  r = await req("POST", "/api/gacha/draw", {}, tokenA);
  ok(
    r.status === 402 && r.json?.code === "PET_LIMIT_REACHED",
    "A gacha blocked before payment",
    "status=" + r.status,
  );

  // ---- simulate payment: user-level global unlock ----
  await pool.query("UPDATE users SET is_unlocked = true WHERE email = $1", [emailA]);
  const okA = [];
  for (const t of ["dog", "penguin", "fox"]) {
    r = await req("POST", "/api/adopt", { petType: t }, tokenA);
    okA.push(r.status === 200 && r.json?.ok === true);
  }
  ok(okA.every(Boolean), "A can adopt unlimited after unlock (3 more pets)", `ok=${okA.filter(Boolean).length}/3`);

  // ---- parallel adopt race for fresh user C -> exactly 1 pet ----
  r = await req("POST", "/api/auth/register", { email: emailC, password: "perfpass123" });
  const tokenC = r.json?.token;
  const parallel = await Promise.all([
    req("POST", "/api/adopt", { petType: "fox" }, tokenC),
    req("POST", "/api/adopt", { petType: "dog" }, tokenC),
    req("POST", "/api/adopt", { petType: "penguin" }, tokenC),
  ]);
  const okCount = parallel.filter((x) => x.status === 200 && x.json?.ok).length;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM adoptions WHERE user_id = (SELECT id::text FROM users WHERE email=$1)`,
    [emailC],
  );
  ok(okCount === 1 && Number(rows[0].n) === 1, "parallel adopts -> exactly 1 pet", `ok=${okCount} dbCount=${rows[0].n}`);

  // ---- cleanup ----
  await pool.query(
    `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'unlock_%@test.aiabw'))`
  );
  await pool.query(`DELETE FROM adoptions WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'unlock_%@test.aiabw')`);
  await pool.query(`DELETE FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'unlock_%@test.aiabw')`);
  await pool.query(`DELETE FROM users WHERE email LIKE 'unlock_%@test.aiabw'`);
  await pool.end();

  const passed = results.filter(Boolean).length;
  console.log("----------------------------------");
  console.log(`SUMMARY: ${passed}/${results.length} passed (live=${BASE})`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });

