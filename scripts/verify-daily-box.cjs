// 每日福利箱运营策略 E2E：改名/价格红线/每日限购/积分通道不限/todayClaimed
// Usage: node scripts/verify-daily-box.cjs http://localhost:3000
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3000";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const XORPAY_SECRET = (env.match(/^XORPAY_SECRET=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

let pass = 0;
let fail = 0;
function out(s) { fs.writeSync(1, s + "\n"); }
function assert(cond, label, extra = "") {
  const s = (cond ? "  PASS " : "  FAIL ") + label + (extra ? "  " + extra : "");
  if (cond) { pass++; } else { fail++; }
  out(s);
}
const q = (sql, p) => Promise.race([pool.query(sql, p), new Promise((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 30000))]);
async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
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
  return (await fetch(BASE + "/api/pay/notify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).text();
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const email = `bxd_${ts}@test.aiabw`;
  const reg = await req("POST", "/api/auth/register", { email, password: "bxdpass123" });
  const token = reg.json?.token;
  const uid = (await q("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;
  await q("UPDATE users SET points = 0 WHERE id = $1", [uid]);

  // 1) 池信息：改名 + 价格红线
  const list = await req("GET", "/api/blindbox", null, token);
  const daily = list.json?.pools?.find((p) => p.id === "newbie_welcome");
  assert(daily?.name === "每日福利箱", "池名已改为 每日福利箱", "name=" + daily?.name);
  assert(Number(daily?.priceCny) >= 1, "价格红线 ≥1 元", "price=" + daily?.priceCny);
  assert(daily?.todayClaimed === false, "首次 todayClaimed=false");

  // 2) 首次 cash 下单成功
  const d1 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "cash" }, token);
  assert(d1.status === 200 && d1.json?.needPayment === true, "首次现金下单成功", "amount=" + d1.json?.amount);

  // 3) 模拟支付成功 → 抽取完成
  const cb = await notify(d1.json.orderId, d1.json.amount.toFixed(2));
  assert(cb === "success", "模拟支付回调 success");

  // 4) 再次现金下单 → 429 每日限购
  const d2 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "cash" }, token);
  assert(d2.status === 429 && d2.json?.ok === false, "每日限购：第二次现金下单被 429 拦截", "status=" + d2.status);

  // 5) 列表 todayClaimed=true
  const list2 = await req("GET", "/api/blindbox", null, token);
  const daily2 = list2.json?.pools?.find((p) => p.id === "newbie_welcome");
  assert(daily2?.todayClaimed === true, "领取后 todayClaimed=true");

  // 6) 积分通道不限购（积分足够仍可抽）
  await q("UPDATE users SET points = 500 WHERE id = $1", [uid]);
  const d3 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "points" }, token);
  assert(d3.status === 200 && d3.json?.ok, "积分通道不受每日限购影响", "status=" + d3.status);

  // 7) 价格红线硬校验：临时把池价改为 0.5 → draw 400
  await q(`UPDATE blindbox_pools SET price_cny = 0.5 WHERE id = 'newbie_welcome'`);
  const d4 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "cash" }, token);
  assert(d4.status === 400, "价格<1 被硬校验拦截（400）", "status=" + d4.status);
  await q(`UPDATE blindbox_pools SET price_cny = 1.0 WHERE id = 'newbie_welcome'`);

  // 清理
  await q(`DELETE FROM blindbox_logs WHERE user_id=$1`, [uid]);
  await q(`DELETE FROM user_collectibles WHERE owner_id=$1`, [uid]);
  await q(`DELETE FROM points_log WHERE user_id=$1`, [uid]);
  await pool.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
