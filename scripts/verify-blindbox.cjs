// 盲盒引擎 E2E（本地 dev server）：普通/传说/回滚/并发/回调幂等
// Usage: node scripts/verify-blindbox.cjs http://localhost:3000
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, p) => Promise.race([pool.query(sql, p), new Promise((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 30000))]);

async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
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

// 模拟 XorPay 回调（官方验签）
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
  const password = "bxpass123";
  const allEmails = [];

  // 0) 准备测试奖池
  const normalPool = `bx_normal_${ts}`;
  const legendPool = `bx_legend_${ts}`;
  await q(
    `INSERT INTO blindbox_pools (id, name_zh, name_en, price_cny, price_points, probabilities, is_active)
     VALUES ($1, '测试普通箱', 'Test Box', 1, 200, $2::jsonb, true)`,
    [normalPool, JSON.stringify({ common: 0.9, rare: 0.1 })],
  );
  await q(
    `INSERT INTO blindbox_pools (id, name_zh, name_en, price_cny, price_points, probabilities, is_active)
     VALUES ($1, '测试传说箱', 'Legend Box', 1, 200, $2::jsonb, true)`,
    [legendPool, JSON.stringify({ rare: 0.5, legendary: 0.5 })],
  );

  // A) 注册 + 积分
  const email = `bx_${ts}@test.aiabw`;
  allEmails.push(email);
  const reg = await req("POST", "/api/auth/register", { email, password });
  const token = reg.json?.token;
  const uid = (await q("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;
  await q("UPDATE users SET points = 5000 WHERE id = $1", [uid]);

  // 1) 普通款抽奖
  const d1 = await req("POST", "/api/blindbox/draw", { poolId: normalPool }, token);
  assert(d1.status === 200 && d1.json?.ok, "普通款抽奖成功", "status=" + d1.status);
  assert(d1.json?.isLegendary === false, "普通款 is_legendary=false");
  const pt1 = (await q("SELECT points FROM users WHERE id=$1", [uid])).rows[0];
  assert(pt1.points === 4800, "扣费 200 积分（5000→4800）", "points=" + pt1.points);
  const uc1 = await q(`SELECT count(*)::int AS n FROM user_collectibles WHERE owner_id=$1`, [uid]);
  assert(uc1.rows[0].n === 1, "NFR 铸造入 user_collectibles", "n=" + uc1.rows[0].n);
  const log1 = await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE user_id=$1 AND pool_id=$2`, [uid, normalPool]);
  assert(log1.rows[0].n === 1, "盲盒流水写入", "n=" + log1.rows[0].n);

  // 2) 积分不足 → 402 + 回滚
  await q("UPDATE users SET points = 100 WHERE id = $1", [uid]);
  const d2 = await req("POST", "/api/blindbox/draw", { poolId: normalPool }, token);
  assert(d2.status === 402, "积分不足 402", "status=" + d2.status);
  const pt2 = (await q("SELECT points FROM users WHERE id=$1", [uid])).rows[0];
  assert(pt2.points === 100, "回滚：未扣分", "points=" + pt2.points);
  const uc2 = await q(`SELECT count(*)::int AS n FROM user_collectibles WHERE owner_id=$1`, [uid]);
  assert(uc2.rows[0].n === 1, "回滚：未新增铸造", "n=" + uc2.rows[0].n);
  const log2 = await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE user_id=$1`, [uid]);
  assert(log2.rows[0].n === 1, "回滚：无新流水", "n=" + log2.rows[0].n);

  // 3) 传说款（50% 概率，抽 6 次必出）
  await q("UPDATE users SET points = 5000 WHERE id = $1", [uid]);
  let legendaryHit = false;
  for (let i = 0; i < 6; i++) {
    const dl = await req("POST", "/api/blindbox/draw", { poolId: legendPool }, token);
    if (dl.json?.isLegendary) { legendaryHit = true; break; }
  }
  assert(legendaryHit, "传说款抽出（is_legendary=true）");
  const lg = await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE user_id=$1 AND pool_id=$2 AND is_legendary=true`, [uid, legendPool]);
  assert(lg.rows[0].n >= 1, "传说款流水 is_legendary=true", "n=" + lg.rows[0].n);
  // 4) 并发 8 连抽（积分充足）
  await q("UPDATE users SET points = 5000 WHERE id = $1", [uid]);
  const beforeLogs = (await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE user_id=$1`, [uid])).rows[0].n;
  const beforeUc = (await q(`SELECT count(*)::int AS n FROM user_collectibles WHERE owner_id=$1`, [uid])).rows[0].n;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => req("POST", "/api/blindbox/draw", { poolId: normalPool }, token)),
  );
  const allOk = results.every((r) => r.status === 200 && r.json?.ok);
  assert(allOk, "并发 8 连抽全部成功", "failed=" + results.filter((r) => r.status !== 200).length);
  const afterLogs = (await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE user_id=$1`, [uid])).rows[0].n;
  assert(afterLogs - beforeLogs === 8, "并发后流水 +8（不超发）", "diff=" + (afterLogs - beforeLogs));
  const afterUc = (await q(`SELECT count(*)::int AS n FROM user_collectibles WHERE owner_id=$1`, [uid])).rows[0].n;
  assert(afterUc - beforeUc === 8, "并发后铸造 +8", "diff=" + (afterUc - beforeUc));
  const pt4 = (await q("SELECT points FROM users WHERE id=$1", [uid])).rows[0];
  assert(pt4.points === 5000 - 200 * (afterLogs - beforeLogs), "总消耗积分正确", "points=" + pt4.points);

  // 5) XorPay 回调幂等
  const payBx = await req("POST", "/api/pay/create", { kind: "blindbox", poolId: normalPool }, token);
  assert(payBx.status === 200 && /^blindbox-/.test(payBx.json?.orderId ?? ""), "XorPay 盲盒下单（order_id=blindbox-*）");
  const orderId = payBx.json?.orderId;
  const beforeOrderLogs = (await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE order_id=$1`, [orderId])).rows[0].n;
  const cb1 = await notify(orderId, "1.00");
  const cb2 = await notify(orderId, "1.00");
  assert(cb1 === "success" && cb2 === "success", "重复回调均返回 success");
  const afterOrderLogs = (await q(`SELECT count(*)::int AS n FROM blindbox_logs WHERE order_id=$1`, [orderId])).rows[0].n;
  assert(afterOrderLogs - beforeOrderLogs === 1, "同 order_id 只抽一次（幂等）", "diff=" + (afterOrderLogs - beforeOrderLogs));

  // 清理
  for (const p of [normalPool, legendPool]) {
    await q(`DELETE FROM blindbox_logs WHERE pool_id=$1`, [p]);
    await q(`DELETE FROM blindbox_pools WHERE id=$1`, [p]);
  }
  await q(`DELETE FROM user_collectibles WHERE owner_id=$1`, [uid]);
  await q(`DELETE FROM points_log WHERE user_id=$1`, [uid]);

  await pool.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
