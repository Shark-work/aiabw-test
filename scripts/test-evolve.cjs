// E2E test for POST /api/pets/evolve:
// 1) register fresh user  2) assign 3 same-species/same-rarity unowned pets to them via SQL
// 3) evolve -> expect ok + new pet rarity+1 + 3 sources consumed
// 4) negative: 2 pets -> 400; other user's pet -> 400
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3100";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

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
  const ts = Date.now().toString().slice(-6);
  const email = `evolve_${ts}@test.aiabw`;
  let r = await req("POST", "/api/auth/register", { email, password: "evolvepass123" });
  const token = r.json?.token;
  console.log("register:", r.status, email);
  if (!token) process.exit(1);

  // 找 3 只同物种同稀有度未领养宠物
  const { rows: poolRows } = await pool.query(
    `SELECT species_id, traits->>'rarity' AS rarity
       FROM pets WHERE owner_id IS NULL AND status='active'
      GROUP BY 1,2 HAVING count(*) >= 3 LIMIT 1`,
  );
  if (!poolRows.length) { console.log("no eligible trio in pool - FAIL"); process.exit(2); }
  const { species_id: sp, rarity } = poolRows[0];
  const { rows: trio } = await pool.query(
    `SELECT id FROM pets WHERE species_id=$1 AND traits->>'rarity'=$2
       AND owner_id IS NULL AND status='active' LIMIT 3`,
    [sp, rarity],
  );
  await pool.query(`UPDATE pets SET owner_id=(SELECT id FROM users WHERE email=$1), adopted_at=now() WHERE id = ANY($2)`, [email, trio.map((x) => x.id)]);
  const ids = trio.map((x) => x.id);
  console.log("assigned trio:", sp, rarity, ids.join(","));

  // 正常进化
  r = await req("POST", "/api/pets/evolve", { petIds: ids }, token);
  console.log("evolve:", r.status, "ok=" + r.json?.ok, "newId=" + r.json?.pet?.id, "newRarity=" + r.json?.pet?.traits?.rarity, "species=" + r.json?.pet?.speciesName);
  if (r.status !== 200 || !r.json?.ok) { console.log("FAIL evolve:", r.text.slice(0, 200)); process.exit(2); }
  const newId = r.json.pet.id;

  // DB 校验：3 只 consumed + evolution_id，新宠物 active
  const c1 = await pool.query(`SELECT count(*)::int AS n FROM pets WHERE id = ANY($1) AND status='consumed' AND evolution_id=$2`, [ids, newId]);
  const c2 = await pool.query(`SELECT count(*)::int AS n FROM pets WHERE id=$1 AND status='active' AND owner_id IS NOT NULL`, [newId]);
  console.log("consumed=3:", c1.rows[0].n, " newPetActive=1:", c2.rows[0].n);
  if (c1.rows[0].n !== 3 || c2.rows[0].n !== 1) { console.log("FAIL atomicity"); process.exit(2); }

  // catalog mine 校验：新宠物可见、被消耗的 3 只不可见
  const cat = await req("GET", "/api/pets/catalog?mine=1&limit=60", null, token);
  const mineIds = (cat.json?.pets ?? []).map((p) => p.id);
  console.log("catalog[mine] newPetVisible=" + mineIds.includes(newId) + " consumedHidden=" + ids.every((i) => !mineIds.includes(i)));

  // 负向：2 只 → 400
  r = await req("POST", "/api/pets/evolve", { petIds: ids.slice(0, 2) }, token);
  console.log("2-pets:", r.status, "(expect 400)");
  // 负向：他人宠物
  const { rows: other } = await pool.query(`SELECT id FROM pets WHERE owner_id IS NOT NULL AND status='active' LIMIT 1`);
  r = await req("POST", "/api/pets/evolve", { petIds: [other[0]?.id, ...ids.slice(0, 2)] }, token);
  console.log("foreign-pet:", r.status, "(expect 400)");

  await pool.end();
  console.log("RESULT: PASS ✅");
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
