// Live-domain full-chain regression against https://www.aiabw.com
// Flow: register -> creator apply -> publish -> register buyer -> buy -> gacha -> adopt -> checkin
// DB verification via shared Neon DATABASE_URL from .env
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";
if (!DATABASE_URL) {
  console.error("no DATABASE_URL in .env");
  process.exit(1);
}

async function req(method, apiPath, body, token, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
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
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

const results = [];
function ok(cond, label, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  [" + extra + "]" : ""));
  results.push(cond);
}

async function cleanup(pool) {
  console.log("cleanup: removing @test.aiabw test rows...");
  await pool.query("BEGIN");
  try {
    await pool.query(
      `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE '%@test.aiabw'))`
    );
    await pool.query(`DELETE FROM points_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.aiabw')`);
    await pool.query(`DELETE FROM handbooks WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.aiabw')`);
    await pool.query(
      `DELETE FROM ugc_sales WHERE buyer_id IN (SELECT id FROM users WHERE email LIKE '%@test.aiabw') OR creator_id IN (SELECT id FROM users WHERE email LIKE '%@test.aiabw')`
    );
    await pool.query(`DELETE FROM adoptions WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE '%@test.aiabw')`);
    await pool.query(`DELETE FROM threads WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE '%@test.aiabw')`);
    await pool.query(`DELETE FROM ugc_pets WHERE creator_id IN (SELECT id FROM users WHERE email LIKE '%@test.aiabw')`);
    await pool.query(`DELETE FROM users WHERE email LIKE '%@test.aiabw'`);
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM users WHERE email LIKE '%@test.aiabw')::int AS users,
            (SELECT count(*) FROM adoptions WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE '%@test.aiabw'))::int AS adopts`
  );
  console.log("cleanup done  remaining test users=" + rows[0].users + " adoptions=" + rows[0].adopts);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  if (process.argv[2] === "--cleanup") {
    await cleanup(pool);
    await pool.end();
    return;
  }

  const ts = Date.now().toString().slice(-7);
  const creatorEmail = "reg_c_" + ts + "@test.aiabw";
  const buyerEmail = "reg_b_" + ts + "@test.aiabw";
  const password = "regpass2026";

  let r = await req("POST", "/api/auth/register", { email: creatorEmail, password });
  ok(r.status === 200 && r.json?.ok === true && !!r.json?.token, "register creator", "status=" + r.status);
  const creatorToken = r.json?.token;

  r = await req("POST", "/api/creator/apply", {}, creatorToken);
  ok(r.status === 200 && r.json?.ok === true && r.json?.isCreator === true, "creator apply", "status=" + r.status);

  r = await req("POST", "/api/creator/publish", {
    name: "reg-pet-" + ts,
    imageUrl: "https://example.com/pet.png",
    systemPrompt: "You are a regression test pet.",
    priceOrPoints: 60,
  }, creatorToken);
  const petId = r.json?.pet?.id;
  ok(r.status === 200 && r.json?.ok === true && !!petId, "creator publish", "petId=" + (petId || "?"));

  r = await req("POST", "/api/auth/register", { email: buyerEmail, password });
  ok(r.status === 200 && r.json?.ok === true && !!r.json?.token, "register buyer", "status=" + r.status);
  const buyerToken = r.json?.token;

  let dbRows = [];
  try {
    const { rows } = await pool.query(
      "SELECT email, points, is_creator FROM users WHERE email = ANY($1)",
      [[creatorEmail, buyerEmail]]
    );
    dbRows = rows;
  } catch (e) {
    console.log("WARN  db query: " + e.message);
  }
  const emailsFound = dbRows.map((x) => x.email).sort().join(",");
  const sameDb = dbRows.some((x) => x.email === creatorEmail) && dbRows.some((x) => x.email === buyerEmail);
  ok(sameDb, "live app shares local DATABASE_URL DB", "found=" + emailsFound);

  if (sameDb) {
    const creatorRow = dbRows.find((x) => x.email === creatorEmail);
    ok(creatorRow?.is_creator === true, "creator.is_creator persisted in DB");

    await pool.query("UPDATE users SET points = 500 WHERE email = $1", [buyerEmail]);
    console.log("INFO  buyer points topped up to 500 via SQL");

    r = await req("GET", "/api/pets", null, buyerToken);
    ok(r.status === 200 && r.json?.ok === true && Array.isArray(r.json?.pets), "pets list", "status=" + r.status + " count=" + (r.json?.pets?.length ?? "?"));

    r = await req("POST", "/api/pet/buy", { petId }, buyerToken);
    ok(r.status === 200 && r.json?.ok === true && r.json?.pointsDeducted === 60, "buy ugc pet", "deducted=" + r.json?.pointsDeducted + " status=" + r.status);

    // 单宠限制：免费用户购买第 1 只后，盲盒/再次领养会被 402 拦截。
    // 这里模拟“已付费全局解锁”（users.is_unlocked），使后续 gacha + adopt 继续走通。
    await pool.query(
      `UPDATE users SET is_unlocked = true WHERE email = $1`,
      [buyerEmail]
    );
    console.log("INFO  buyer marked as globally unlocked (simulated payment)");

    r = await req("POST", "/api/gacha/draw", {}, buyerToken);
    ok(r.status === 200 && r.json?.ok === true && r.json?.cost === 100 && !!r.json?.petType, "gacha draw", "cost=" + r.json?.cost + " got=" + r.json?.petType);

    r = await req("POST", "/api/adopt", { petType: "fox" }, buyerToken);
    ok(r.status === 200 && r.json?.ok === true && !!r.json?.threadId, "adopt official pet", "status=" + r.status + " threadId=" + (r.json?.threadId ? "true" : "false"));

    r = await req("POST", "/api/user/checkin", {}, buyerToken);
    ok(r.status === 200 && r.json?.ok === true && r.json?.already === false, "daily checkin +10", "points=" + r.json?.points);

    const q = await pool.query(
      `SELECT (SELECT points FROM users WHERE email=$1)::int AS points,
              (SELECT creator_balance FROM users WHERE email=$2)::int AS balance,
              (SELECT count(*) FROM ugc_sales s JOIN users u ON u.id=s.buyer_id WHERE u.email=$1)::int AS sales,
              (SELECT count(*) FROM adoptions WHERE user_id=(SELECT id::text FROM users WHERE email=$1))::int AS adopts`,
      [buyerEmail, creatorEmail]
    );
    const row = q.rows[0];
    ok(Number(row.points) === 350, "buyer points balance = 350 (500-60-100+10)", "actual=" + row.points);
    ok(Number(row.balance) === 60, "creator balance = 60", "actual=" + row.balance);
    ok(Number(row.sales) === 1, "ugc_sales has 1 row", "count=" + row.sales);
    ok(Number(row.adopts) === 3, "buyer has 3 adoptions (buy+gacha+adopt)", "count=" + row.adopts);
  } else {
    console.log("ABORT: live app uses a different DB than local .env - SQL top-up skipped");
  }

  await pool.end();

  const passed = results.filter(Boolean).length;
  console.log("----------------------------------");
  console.log("SUMMARY: " + passed + "/" + results.length + " passed  (live=" + BASE + ")");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL: " + e.message);
  process.exit(2);
});
