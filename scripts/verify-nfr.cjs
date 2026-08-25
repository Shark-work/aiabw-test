// NFR 合规架构 E2E（本地 dev server）：领养铸造 / 繁育 / 转赠冷却 / Gallery owned / Token 压缩
// 1) 领养成功同步铸造 user_collectibles（hash_id + 首发转赠冷却 24h）
// 2) 繁育：扣 200 积分 + 子代确权（generation=2 + 亲本哈希溯源）
// 3) 繁育冷却拦截（429）+ 积分不足拦截（402）
// 4) 转赠冷却拦截（403 COOLDOWN）→ 冷却过期后转赠成功（新主人 7 天冷却）
// 5) Gallery owned 标记（持有 = true / 未持有 = false）
// 6) 上下文压缩：15 轮对话压缩后 payload 显著下降（D7: 阈值 10 / 保留 5）
// Usage: node scripts/verify-nfr.cjs http://localhost:3000
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3000";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

let pass = 0;
let fail = 0;
function assert(cond, label, extra = "") {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? "  " + extra : ""));
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const password = "nfrpass123";

  // ---- A) 领养铸造（新用户第 1 只，免费路径）----
  const emailA = `nfra_${ts}@test.aiabw`;
  const regA = await req("POST", "/api/auth/register", { email: emailA, password });
  const tokenA = regA.json?.token;
  assert(!!tokenA, "A 注册成功");

  const cat1 = await req("GET", "/api/pets/catalog?limit=60");
  const poolPets = (cat1.json?.pets || []).filter((p) => !p.owned);
  assert(poolPets.length >= 2, "图鉴池有至少 2 只未领养宠物", "n=" + poolPets.length);
  // 繁育要求同物种：按 speciesId 分组，取同一物种的 2 只
  const bySpecies = new Map();
  for (const p of poolPets) {
    if (!bySpecies.has(p.speciesId)) bySpecies.set(p.speciesId, []);
    bySpecies.get(p.speciesId).push(p);
  }
  const sameSpecies = [...bySpecies.values()].find((arr) => arr.length >= 2);
  assert(!!sameSpecies, "图鉴池存在同物种至少 2 只未领养宠物（繁育前提）");
  const [P1, P2] = sameSpecies;

  const claim1 = await req("POST", "/api/pets/claim", { petId: P1.id }, tokenA);
  assert(claim1.status === 200 && claim1.json?.ok, "领养#1 成功");
  assert(!!claim1.json?.nfr?.hashId, "领养响应携带 NFR 确权信息（hashId）");
  const uidA = (await pool.query("SELECT id FROM users WHERE email=$1", [emailA])).rows[0]?.id;

  const ucA = await pool.query(
    `SELECT id, hash_id, generation, locked_until, status, source_pet_id, adoption_id
       FROM user_collectibles WHERE owner_id=$1 ORDER BY minted_at DESC`,
    [uidA],
  );
  assert(ucA.rows.length === 1, "user_collectibles 已写入 1 条确权记录", "n=" + ucA.rows.length);
  assert(ucA.rows[0].hash_id === claim1.json?.nfr?.hashId, "hash_id 前后一致（防伪可校验）");
  assert(new Date(ucA.rows[0].locked_until) > new Date(), "首发转赠冷却期已设置（未来时间）");
  assert(ucA.rows[0].source_pet_id === P1.id, "source_pet_id 关联宠物实例");
  assert(!!ucA.rows[0].adoption_id, "adoption_id 关联领养记录（可对话）");
  const uc1Id = ucA.rows[0].id;

  // ---- A2) 免费用户第 2 只被拦截（402 支付门槛仍生效）----
  const claim2Blocked = await req("POST", "/api/pets/claim", { petId: P2.id }, tokenA);
  assert(
    claim2Blocked.status === 402 && claim2Blocked.json?.needPayment === true,
    "免费用户第 2 只仍被 402 支付拦截",
    "status=" + claim2Blocked.status,
  );

  // ---- B) 繁育（解锁用户 + 给积分 + 第 2 只 → 2 亲本繁育）----
  await pool.query("UPDATE users SET is_unlocked = true, points = 1000 WHERE id = $1", [uidA]);
  const claim2 = await req("POST", "/api/pets/claim", { petId: P2.id }, tokenA);
  assert(claim2.status === 200, "解锁后领养#2 放行（无限领养）", "status=" + claim2.status);
  const uc2 = await pool.query(
    `SELECT id FROM user_collectibles WHERE owner_id=$1 AND id <> $2 ORDER BY minted_at DESC LIMIT 1`,
    [uidA, uc1Id],
  );
  assert(uc2.rows.length === 1, "第 2 只也完成 NFR 铸造");
  const uc2Id = uc2.rows[0].id;

  const breedCold = await req("POST", "/api/pets/breed", { parentIds: [uc1Id, uc2Id] }, tokenA);
  assert(
    breedCold.status === 429,
    "亲本繁育冷却期拦截（429）",
    "status=" + breedCold.status + " " + JSON.stringify(breedCold.json).slice(0, 80),
  );
  await pool.query(
    `UPDATE user_collectibles SET breed_cooldown_until = now() - interval '1 day' WHERE owner_id=$1`,
    [uidA],
  );
  const breed = await req("POST", "/api/pets/breed", { parentIds: [uc1Id, uc2Id] }, tokenA);
  console.log("  breed ->", breed.status, JSON.stringify(breed.json?.nfr || breed.json).slice(0, 200));
  assert(breed.status === 200 && breed.json?.ok, "繁育成功（200）", "status=" + breed.status);
  const nfrB = breed.json?.nfr || {};
  assert(!!nfrB.hashId && nfrB.generation === 2, "子代确权：generation=2 + hash_id 生成");
  assert(Array.isArray(breed.json?.parentHashIds) && breed.json.parentHashIds.length === 2, "子代携带双亲哈希溯源");
  assert(!!nfrB.adoptionId, "子代创建领养记录（可进入对话）");
  const ptA = (await pool.query("SELECT points FROM users WHERE id=$1", [uidA])).rows[0];
  assert(ptA.points === 800, "繁育扣除 200 积分（1000→800）", "points=" + ptA.points);
  const logB = await pool.query(`SELECT count(*)::int AS n FROM points_log WHERE user_id=$1 AND reason='breed'`, [uidA]);
  assert(logB.rows[0].n === 1, "写入 breed 积分流水");

  // ---- C) 积分不足拦截 ----
  const emailC = `nfrc_${ts}@test.aiabw`;
  const regC = await req("POST", "/api/auth/register", { email: emailC, password });
  const tokenC = regC.json?.token;
  const uidC = (await pool.query("SELECT id FROM users WHERE email=$1", [emailC])).rows[0]?.id;
  await pool.query("UPDATE users SET is_unlocked = true, points = 50 WHERE id = $1", [uidC]);
  // C 领养同物种 2 只（积分不足测试用，points=50 < 200；P1/P2 已被 A 领养 → 重新取对）
  const catC = await req("GET", "/api/pets/catalog?limit=60");
  const freeC = (catC.json?.pets || []).filter((p) => !p.owned);
  const bySpC = new Map();
  for (const p of freeC) {
    if (!bySpC.has(p.speciesId)) bySpC.set(p.speciesId, []);
    bySpC.get(p.speciesId).push(p);
  }
  const pairC = [...bySpC.values()].find((arr) => arr.length >= 2);
  assert(!!pairC, "C 测试存在同物种 2 只未领养宠物");
  const claimC1 = await req("POST", "/api/pets/claim", { petId: pairC[0].id }, tokenC);
  const claimC2 = await req("POST", "/api/pets/claim", { petId: pairC[1].id }, tokenC);
  assert(claimC1.status === 200 && claimC2.status === 200, "C 领养同物种 2 只用于测试积分不足");
  const ucC = await pool.query(
    `SELECT id FROM user_collectibles WHERE owner_id=$1 ORDER BY minted_at DESC LIMIT 2`,
    [uidC],
  );
  assert(ucC.rows.length === 2, "C 已铸造 2 件 NFR");
  // 清除亲本繁育冷却，确保命中「积分不足」(402) 而非冷却 (429)
  await pool.query(
    `UPDATE user_collectibles SET breed_cooldown_until = now() - interval '1 day' WHERE owner_id=$1`,
    [uidC],
  );
  const poorBreed = await req("POST", "/api/pets/breed", { parentIds: [ucC.rows[0].id, ucC.rows[1].id] }, tokenC);
  assert(
    poorBreed.status === 402,
    "积分不足繁育拦截（402）",
    "status=" + poorBreed.status + " " + JSON.stringify(poorBreed.json).slice(0, 80),
  );
  const ptC = (await pool.query("SELECT points FROM users WHERE id=$1", [uidC])).rows[0];
  assert(ptC.points === 50, "积分不足时未扣分（回滚）", "points=" + ptC.points);

  // ---- D) 转赠冷却拦截（403 COOLDOWN）----
  const emailB = `nfrb_${ts}@test.aiabw`;
  const regB = await req("POST", "/api/auth/register", { email: emailB, password });
  const tokenB = regB.json?.token;
  const uidB = (await pool.query("SELECT id FROM users WHERE email=$1", [emailB])).rows[0]?.id;

  const tCold = await req("POST", "/api/pets/transfer", { collectibleId: uc1Id, toUserId: uidB }, tokenA);
  console.log("  transfer(cold) ->", tCold.status, JSON.stringify(tCold.json).slice(0, 120));
  assert(
    tCold.status === 403 && tCold.json?.code === "COOLDOWN",
    "转赠冷却期拦截（403 COOLDOWN + retryAfter）",
    "status=" + tCold.status,
  );
  assert(typeof tCold.json?.retryAfter === "number", "响应含 retryAfter 剩余秒数");
  await pool.query(`UPDATE user_collectibles SET locked_until = now() - interval '1 minute' WHERE id = $1`, [uc1Id]);
  const tOk = await req("POST", "/api/pets/transfer", { collectibleId: uc1Id, toUserId: uidB }, tokenA);
  console.log("  transfer(ok) ->", tOk.status, JSON.stringify(tOk.json).slice(0, 120));
  assert(tOk.status === 200 && tOk.json?.ok, "冷却过期后转赠成功", "status=" + tOk.status);
  assert(tOk.json?.newOwnerId === uidB, "所有权转移给接收者");
  const tOwner = (await pool.query("SELECT owner_id, locked_until, transferred_count FROM user_collectibles WHERE id=$1", [uc1Id])).rows[0];
  assert(tOwner.owner_id === uidB, "数据库 owner_id 已更新");
  assert(new Date(tOwner.locked_until) > new Date(), "新主人冷却期重置（未来 7 天）");
  assert(Number(tOwner.transferred_count) === 1, "transferred_count +1");
  const petOwner = (await pool.query("SELECT owner_id FROM pets WHERE id=$1", [P1.id])).rows[0];
  assert(petOwner.owner_id === uidB, "pets.owner_id 已同步转移");

  // ---- E) Gallery owned 标记 ----
  const galA = await req("GET", "/api/gallery", null, tokenA);
  assert(galA.status === 200 && Array.isArray(galA.json?.items), "gallery 接口可用");
  const collId1 = `${P1.speciesId}:${P1.traits?.rarity ?? "common"}`;
  const item1 = (galA.json?.items || []).find((x) => x.id === collId1);
  assert(item1 && item1.owned === true, "Gallery 对持有者标记 owned=true（领养铸造的藏品）");
  const galB = await req("GET", "/api/gallery", null, tokenB);
  const itemB = (galB.json?.items || []).find((x) => x.id === collId1);
  assert(itemB && itemB.owned === true, "Gallery 对转赠接收者也标记 owned=true");
  const otherItem = (galB.json?.items || []).find((x) => x.id !== collId1);
  assert(otherItem && otherItem.owned === false, "Gallery 未持有藏品标记 owned=false");

  // ---- F) 上下文压缩 Token 降本验证（D7: 阈值 10 / 保留 5）----
  const { compressConversation } = await import("../src/lib/context-compress.ts");
  const topics = ["大象主要吃什么食物", "金毛寻回犬适合养在家里吗", "企鹅为什么不会飞"];
  function buildMsgs(n) {
    const m = [];
    for (let i = 1; i <= n; i++) {
      m.push({ role: "user", parts: [{ type: "text", text: topics[i % topics.length] }] });
      m.push({ role: "assistant", parts: [{ type: "text", text: `第${i}轮回复：${topics[i % topics.length]}的详细回答内容。` }] });
    }
    return m;
  }
  const shortRes = compressConversation(buildMsgs(3));
  const longMsgs = buildMsgs(15);
  const longRes = compressConversation(longMsgs);
  const longBefore = JSON.stringify(longMsgs).length;
  const longAfter = JSON.stringify(longRes.messages).length + (longRes.summary || "").length;
  const savePct = ((longBefore - longAfter) / longBefore * 100).toFixed(1);
  console.log(`  token: 15轮 ${longBefore}B → ${longAfter}B (省 ${savePct}%, 归档 ${longRes.compressedTurns} 轮)`);
  assert(shortRes.compressedTurns === 0, "短对话（3 轮 ≤10 阈值）不压缩，保持原样");
  assert(longRes.compressedTurns === 10, "15 轮对话归档前 10 轮（保留最近 5）", "归档=" + longRes.compressedTurns);
  assert(savePct > 30, "15 轮对话压缩后 payload 节省 >30%", "省" + savePct + "%");

  // ---- 清理测试数据（先删 NFR 确权：含转赠后引用本组 adoptions/pets 的记录）----
  for (const email of [emailA, emailB, emailC]) {
    const u = (await pool.query("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;
    if (!u) continue;
    await pool.query(
      `DELETE FROM user_collectibles
        WHERE owner_id = $1
           OR adoption_id IN (
                SELECT id FROM adoptions
                 WHERE user_id = $1::text OR thread_id IN (SELECT id FROM threads WHERE user_id = $1::text))
           OR source_pet_id IN (SELECT id FROM pets WHERE owner_id = $1)`,
      [u],
    );
    await pool.query(
      `DELETE FROM adoptions WHERE user_id=$1::text OR thread_id IN (SELECT id FROM threads WHERE user_id=$1::text)`,
      [u],
    );
    await pool.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id=$1::text)`, [u]);
    await pool.query(`DELETE FROM threads WHERE user_id=$1`, [u]);
    await pool.query(`DELETE FROM points_log WHERE user_id=$1`, [u]);
    await pool.query(`UPDATE pets SET owner_id=NULL, adopted_at=NULL, last_interaction_time=NULL WHERE owner_id=$1`, [u]);
  }

  await pool.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
