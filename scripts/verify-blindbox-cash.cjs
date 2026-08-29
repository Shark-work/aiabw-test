// 盲盒现金通道 E2E（本地 dev server）：
// 验证 paymentMethod=cash：积分不足 → 下单(needPayment+orderId+qr) → 未支付轮询
// → 模拟 XorPay notify → 轮询返回抽取结果；且 cash 不扣积分。
// Usage: node scripts/verify-blindbox-cash.cjs http://localhost:3000
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
  return (await fetch(BASE + "/api/pay/notify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })).text();
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const email = `bxc_${ts}@test.aiabw`;
  const reg = await req("POST", "/api/auth/register", { email, password: "bxcpass123" });
  const token = reg.json?.token;
  const uid = (await q("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;
  // 积分归零 → 触发现金兜底
  await q("UPDATE users SET points = 0 WHERE id = $1", [uid]);

  // 1) 积分不足 + cash 下单
  const d1 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "cash" }, token);
  assert(d1.status === 200 && d1.json?.ok && d1.json?.needPayment === true, "cash 下单返回 needPayment=true");
  assert(/^blindbox-/.test(d1.json?.orderId ?? ""), "返回 orderId（blindbox- 前缀）", "orderId=" + d1.json?.orderId);
  assert(typeof d1.json?.qr === "string" && d1.json.qr.length > 10, "返回支付二维码 qr");
  assert(Number(d1.json?.amount) > 0, "返回金额 amount", "amount=" + d1.json?.amount);
  const orderId = d1.json.orderId;

  // 2) 未支付轮询 → 仍 needPayment
  const d2 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "cash", orderId }, token);
  assert(d2.json?.ok && d2.json?.needPayment === true, "未支付轮询返回 needPayment（不重复抽取）");

  // 3) 模拟支付成功（XorPay 回调）→ 抽取执行
  const cb = await notify(orderId, d1.json.amount.toFixed(2));
  assert(cb === "success", "模拟支付回调返回 success", "cb=" + cb);
  const log = await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE order_id=$1`, [orderId]);
  assert(log.rows[0].n === 1, "回调后盲盒流水 +1（订单幂等）");

  // 4) 轮询 → 返回抽取结果（含 nfr）
  const d3 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "cash", orderId }, token);
  assert(d3.status === 200 && d3.json?.ok && !d3.json?.needPayment, "支付后轮询返回抽取结果");
  assert(d3.json?.nfr?.speciesName && d3.json?.nfr?.hashId, "结果含 nfr(speciesName/hashId)");

  // 5) cash 不扣积分
  const pt = (await q("SELECT points FROM users WHERE id=$1", [uid])).rows[0];
  assert(Number(pt.points) === 0, "cash 通道不扣积分", "points=" + pt.points);

  // 6) 积分足够时默认仍走积分通道（points 通道回归）
  await q("UPDATE users SET points = 500 WHERE id = $1", [uid]);
  const d4 = await req("POST", "/api/blindbox/draw", { poolId: "newbie_welcome", paymentMethod: "points" }, token);
  assert(d4.status === 200 && d4.json?.ok && !d4.json?.needPayment, "积分足够：points 通道正常开箱");
  const pt2 = (await q("SELECT points FROM users WHERE id=$1", [uid])).rows[0];
  assert(Number(pt2.points) === 490, "points 通道扣 10 积分", "points=" + pt2.points);

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
