// Test interact endpoint + stale-state logic.
const BASE = process.argv[2] || "http://localhost:3100";
const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const dbUrl = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: dbUrl, max: 2 });

async function req(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

(async () => {
  const login = await req("POST", "/api/auth/login", { email: "qapay_6969222@test.aiabw", password: "qapass2026" });
  const token = login.json?.token;
  console.log("login=" + login.status);

  // 找一只该用户拥有的预计算宠物，把它变成“被冷落”（5 天前）
  const { rows: owned } = await pool.query(
    `SELECT id FROM pets WHERE owner_id = (SELECT id FROM users WHERE email=$1) LIMIT 1`,
    ["qapay_6969222@test.aiabw"],
  );
  const petId = owned[0]?.id;
  if (!petId) { console.log("no owned pet to test"); return; }
  await pool.query(`UPDATE pets SET last_interaction_time = now() - interval '5 days' WHERE id=$1`, [petId]);
  console.log("stale-seeded pet=" + petId);

  // catalog mine=1 → 检查返回 lastInteractionTime
  const cat = await req("GET", "/api/pets/catalog?mine=1&limit=20", null, token);
  const myPet = cat.json?.pets?.find((p) => p.id === petId);
  console.log("catalog[mine]=" + cat.status + " pet.lastInteractionTime=" + JSON.stringify(myPet?.lastInteractionTime));

  // 互动端点
  const it = await req("POST", `/api/pets/${encodeURIComponent(petId)}/interact`, {}, token);
  console.log("interact=" + it.status + " newTime=" + JSON.stringify(it.json?.lastInteractionTime) + " msg=" + JSON.stringify(it.json?.message));

  // 互动后 DB 应已刷新
  const { rows: after } = await pool.query(`SELECT last_interaction_time FROM pets WHERE id=$1`, [petId]);
  console.log("db-after-interact=" + JSON.stringify(after[0]?.last_interaction_time));

  // 交互无 token -> 401
  const noAuth = await req("POST", `/api/pets/${encodeURIComponent(petId)}/interact`, {}, null);
  console.log("interact no-auth=" + noAuth.status + " (expect 401)");

  await pool.end();
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
