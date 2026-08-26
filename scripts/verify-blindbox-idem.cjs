// 盲盒 E2E 幂等专项：下单 + 同 order_id 两次 notify → 只抽一次
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");
const BASE = process.argv[2] || "http://localhost:3000";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const XORPAY_SECRET = (env.match(/^XORPAY_SECRET=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 10000 });
const out = (s) => fs.writeSync(1, s + "\n");
let pass = 0, fail = 0;
function assert(c, l, x = "") { if (c) pass++; else fail++; out((c ? "  PASS " : "  FAIL ") + l + (x ? "  " + x : "")); }
const q = (sql, p) => Promise.race([pool.query(sql, p), new Promise((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 30000))]);
async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(BASE + apiPath, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}
async function notify(orderId, price) {
  const aoid = "aoid" + Date.now().toString().slice(-6);
  const payTime = new Date().toISOString().replace("T", " ").slice(0, 19);
  const sign = crypto.createHash("md5").update(`${aoid}${orderId}${price}${payTime}${XORPAY_SECRET}`).digest("hex");
  const body = new URLSearchParams({ aoid, order_id: orderId, pay_price: price, pay_time: payTime, sign }).toString();
  return (await fetch(BASE + "/api/pay/notify", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  })).text();
}
(async () => {
  const ts = Date.now().toString().slice(-6);
  const poolId = `bx_idem_${ts}`;
  const email = `bxi_${ts}@test.aiabw`;
  await q(
    `INSERT INTO blindbox_pools (id, name_zh, name_en, price_cny, price_points, probabilities, is_active)
     VALUES ($1, '幂等箱', 'Idem Box', 1, 200, '{"common":1}'::jsonb, true)`,
    [poolId],
  );
  const reg = await req("POST", "/api/auth/register", { email, password: "bxpass123" });
  const token = reg.json?.token;
  const uid = (await q("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;

  const pay = await req("POST", "/api/pay/create", { kind: "blindbox", poolId }, token);
  const orderId = pay.json?.orderId ?? "";
  assert(pay.status === 200 && /^blindbox-/.test(orderId), "XorPay 盲盒下单", "status=" + pay.status + " order=" + orderId.slice(0, 30));

  const c1 = await notify(orderId, "1.00");
  const c2 = await notify(orderId, "1.00");
  assert(c1 === "success" && c2 === "success", "重复回调均返回 success");
  const orderLogs = (await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE order_id=$1`, [orderId])).rows[0].n;
  assert(orderLogs === 1, "同 order_id 只抽一次（幂等）", "n=" + orderLogs);
  const uc = (await q(`SELECT count(*)::int AS n FROM user_collectibles WHERE owner_id=$1`, [uid])).rows[0].n;
  assert(uc === 1, "仅铸造 1 个 NFR", "n=" + uc);

  await q("DELETE FROM blindbox_logs WHERE pool_id=$1", [poolId]);
  await q("DELETE FROM blindbox_pools WHERE id=$1", [poolId]);
  await q("DELETE FROM user_collectibles WHERE owner_id=$1", [uid]);
  await q("DELETE FROM points_log WHERE user_id=$1", [uid]);
  await q("DELETE FROM users WHERE id=$1", [uid]);
  await pool.end();
  out(`RESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { out("FATAL: " + e.message); process.exit(2); });
