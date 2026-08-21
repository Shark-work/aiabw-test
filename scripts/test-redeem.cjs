// E2E test for POST /api/points/redeem-pet:
// register fresh user -> top up 600 points via SQL -> redeem -> assert pet common + points=100
// -> second redeem must be 429 (daily limit).
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3100";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

async function req(method, p, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j };
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const email = `redeem_${ts}@test.aiabw`;
  const reg = await req("POST", "/api/auth/register", null);
  let r = await fetch(BASE + "/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "redeempass123" }),
  }).then((x) => x.json());
  const token = r.token;
  console.log("register:", email, !!token);
  if (!token) process.exit(1);

  // 充值 600 积分
  await pool.query(`UPDATE users SET points = 600 WHERE email = $1`, [email]);

  // 兑换
  r = await req("POST", "/api/points/redeem-pet", token);
  console.log("redeem#1:", r.status, "ok=" + r.json?.ok, "points=" + r.json?.points, "pet=" + (r.json?.pet?.speciesName) + " rarity=" + (r.json?.pet?.traits?.rarity) + " id=" + (r.json?.pet?.id));
  if (r.status !== 200 || !r.json?.ok) { console.log("FAIL redeem#1:", JSON.stringify(r.json)); process.exit(2); }
  if (r.json.points !== 100 || r.json.pet.traits.rarity !== "common") { console.log("FAIL state"); process.exit(2); }

  // 第二天限次：再次兑换 → 429
  r = await req("POST", "/api/points/redeem-pet", token);
  console.log("redeem#2 (same day):", r.status, "(expect 429)");
  if (r.status !== 429) { console.log("FAIL daily limit"); process.exit(2); }

  // DB 校验：points_log -500 记录 + 宠物归属
  const pl = await pool.query(`SELECT amount, reason FROM points_log WHERE user_id=(SELECT id FROM users WHERE email=$1) ORDER BY created_at DESC LIMIT 1`, [email]);
  console.log("points_log:", JSON.stringify(pl.rows[0]));
  const pet = await pool.query(`SELECT count(*)::int AS n FROM pets WHERE owner_id=(SELECT id FROM users WHERE email=$1) AND status='active'`, [email]);
  console.log("owned pets:", pet.rows[0].n, "(expect 1)");

  await pool.end();
  console.log("RESULT: PASS ✅");
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
