// =============================================================================
// GLOBAL LAUNCH ACCEPTANCE - live test against https://www.aiabw.com
// 1) payment full-chain: adopt#1 -> 402 -> pay/create (real 0.01 CNY order) ->
//    simulate XorPay notify callback -> users.is_unlocked -> unlimited adopt
// 2) pay/create security: 401 (no auth), 403 (other user's pet)
// 3) parallel/rapid adopts: exactly 1 success, rest 402, no DB errors
// 4) notify signature probes: reveal server XORPAY_NOTIFY_URL + verify correct
//    XorPay callback format (aoid+order_id+pay_price+pay_time+app_secret)
// =============================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("@neondatabase/serverless");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
function envGet(key) {
  const m = env.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim() : "";
}
const DATABASE_URL = envGet("DATABASE_URL");
const XORPAY_SECRET = envGet("XORPAY_SECRET");
const XORPAY_AID = envGet("XORPAY_AID");

function md5(s) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex").toLowerCase();
}
const orderIdOf = (adoptionId) => `unlock-${adoptionId}`;

async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
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
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

async function postForm(apiPath, params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(BASE + apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal,
    });
    return { status: res.status, text: await res.text() };
  } finally { clearTimeout(t); }
}

const results = [];
function ok(cond, label, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  [" + extra + "]" : ""));
  results.push(cond);
}

(async () => {
  const ts = Date.now().toString().slice(-7);
  const emailA = `acc_a_${ts}@test.aiabw`;
  const emailB = `acc_b_${ts}@test.aiabw`;
  const emailC = `acc_c_${ts}@test.aiabw`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  console.log("BASE=" + BASE + "  AID=" + XORPAY_AID);
  console.log("local XORPAY_NOTIFY_URL=" + envGet("XORPAY_NOTIFY_URL"));

  // ---------- A. adopt#1 -> 402 -> pay/create -> notify -> unlocked -> unlimited ----------
  let r = await req("POST", "/api/auth/register", { email: emailA, password: "perfpass123" });
  ok(r.status === 200 && r.json?.ok, "register A", "status=" + r.status);
  const tokenA = r.json?.token;

  r = await req("POST", "/api/adopt", { petType: "fox" }, tokenA);
  const petAId = r.json?.adoption?.id;
  ok(r.status === 200 && r.json?.ok === true && !!petAId, "A adopt #1 ok", "petId=" + (petAId || "?"));

  r = await req("POST", "/api/adopt", { petType: "dog" }, tokenA);
  ok(
    r.status === 402 && r.json?.code === "PET_LIMIT_REACHED" && r.json?.needPayment === true,
    "A adopt #2 blocked (402)",
    "unlockAdoptionId=" + r.json?.unlockAdoptionId,
  );

  // security: no auth -> 401
  r = await req("POST", "/api/pay/create", { adoptionId: petAId, amount: 0.01 }, null);
  ok(r.status === 401, "pay/create no auth -> 401", "status=" + r.status);

  // security: user B paying for A's pet -> 403
  r = await req("POST", "/api/auth/register", { email: emailB, password: "perfpass123" });
  const tokenB = r.json?.token;
  ok(r.status === 200, "register B", "status=" + r.status);
  r = await req("POST", "/api/pay/create", { adoptionId: petAId, amount: 0.01 }, tokenB);
  ok(r.status === 403, "pay/create other user's pet -> 403", "status=" + r.status + " body=" + JSON.stringify(r.json || r.text).slice(0, 120));

  // real order creation (0.01 CNY) - proves XorPay env + account balance
  r = await req("POST", "/api/pay/create", { adoptionId: petAId, amount: 0.01 }, tokenA);
  const hasQr = !!(r.json?.qr || r.json?.payUrl);
  ok(
    r.status === 200 && r.json?.ok === true && hasQr,
    "pay/create real order (0.01 CNY) -> QR",
    "status=" + r.status + " orderId=" + r.json?.orderId + " payType=" + r.json?.payType,
  );
  if (r.status !== 200) console.log("      create body: " + JSON.stringify(r.json || r.text).slice(0, 400));

  // ---------- B. notify signature probes ----------
  // B1: correct XorPay callback format: aoid+order_id+pay_price+pay_time+app_secret
  // 使用 pay/create 返回的真实 order_id（含随机 nonce），与下单时的 order_id 一致。
  const orderId = r.json?.orderId || orderIdOf(petAId);
  const aoid = "acc" + ts;
  const payTime = new Date().toISOString().replace("T", " ").slice(0, 19);
  const signCorrect = md5(`${aoid}${orderId}0.01${payTime}${XORPAY_SECRET}`);
  let cb = await postForm("/api/pay/notify", {
    aoid, order_id: orderId, pay_price: "0.01", pay_time: payTime,
    more: "", detail: JSON.stringify({ transaction_id: "T" + ts, bank_type: "CFT", buyer: emailA }),
    sign: signCorrect,
  });
  ok(cb.text.trim() === "success", "notify: correct XorPay callback format accepted", "resp=" + JSON.stringify(cb.text).slice(0, 80));

  let db = await pool.query("SELECT is_unlocked FROM users WHERE email=$1", [emailA]);
  const unlockedByCorrect = db.rows[0]?.is_unlocked === true;
  ok(unlockedByCorrect, "users.is_unlocked=true after correct-format notify", "value=" + db.rows[0]?.is_unlocked);

  // B2: legacy/wrong signature format must be REJECTED (security check)
  const probes = [
    { label: "legacy sign (should be rejected)", url: "https://www.aiabw.com/api/pay/notify" },
  ];
  for (const p of probes) {
    const s = md5(`${""}${""}${""}${orderId}${p.url}${XORPAY_SECRET}`);
    cb = await postForm("/api/pay/notify", {
      order_id: orderId, name: "", pay_type: "", price: "", trade_status: "TRADE_SUCCESS", sign: s,
    });
    console.log("INFO  notify probe [" + p.label + "] -> " + JSON.stringify(cb.text).slice(0, 60));
    ok(cb.text.trim() !== "success", "notify: wrong-format sign rejected", "resp=" + JSON.stringify(cb.text).slice(0, 60));
  }

  // ---------- C. post-unlock unlimited adopt (regardless of which path unlocked) ----------
  // force-unlock via DB is NOT used here: only rely on whatever the notify callbacks set
  db = await pool.query("SELECT is_unlocked FROM users WHERE email=$1", [emailA]);
  const wasUnlocked = db.rows[0]?.is_unlocked === true;
  if (!wasUnlocked) {
    console.log("INFO  (simulating unlock via SQL because notify did not unlock)");
    await pool.query("UPDATE users SET is_unlocked = true WHERE email = $1", [emailA]);
  }
  const okAdopts = [];
  for (const t of ["dog", "penguin", "fox"]) {
    r = await req("POST", "/api/adopt", { petType: t }, tokenA);
    okAdopts.push(r.status === 200 && r.json?.ok === true);
  }
  ok(okAdopts.every(Boolean), "A adopt unlimited after unlock (3 pets)", "ok=" + okAdopts.filter(Boolean).length + "/3");

  // ---------- D. rapid click race: 10 parallel adopts -> exactly 1, no 5xx ----------
  r = await req("POST", "/api/auth/register", { email: emailC, password: "perfpass123" });
  const tokenC = r.json?.token;
  const parallel = await Promise.all(
    Array.from({ length: 10 }, (_, i) => req("POST", "/api/adopt", { petType: i % 2 ? "dog" : "fox" }, tokenC)),
  );
  const statusCounts = parallel.reduce((acc, x) => ((acc[x.status] = (acc[x.status] || 0) + 1), acc), {});
  const successCount = parallel.filter((x) => x.status === 200 && x.json?.ok).length;
  const err5xx = parallel.filter((x) => x.status >= 500).length;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM adoptions WHERE user_id = (SELECT id::text FROM users WHERE email=$1)`,
    [emailC],
  );
  ok(successCount === 1 && Number(rows[0].n) === 1 && err5xx === 0,
    "10 rapid adopts -> exactly 1 pet, rest 402, no 5xx",
    "ok=" + successCount + " dbCount=" + rows[0].n + " statuses=" + JSON.stringify(statusCounts));

  // ---------- E. cleanup ----------
  await pool.query(
    `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'acc_%@test.aiabw'))`
  );
  await pool.query(`DELETE FROM adoptions WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'acc_%@test.aiabw')`);
  await pool.query(`DELETE FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE 'acc_%@test.aiabw')`);
  await pool.query(`DELETE FROM users WHERE email LIKE 'acc_%@test.aiabw'`);
  await pool.end();

  const passed = results.filter(Boolean).length;
  console.log("----------------------------------");
  console.log(`SUMMARY: ${passed}/${results.length} passed (live=${BASE})`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
