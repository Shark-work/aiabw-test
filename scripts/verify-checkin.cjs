// P0-1 每日签到 + 心情盲盒 E2E：
// 签到状态 / 连签心情(1·3·7天) / 7天盲盒入库 / 月卡双倍+保底稀有 / 背包列表 / 装备卸下 / 越权防护
// Usage: node scripts/verify-checkin.cjs http://localhost:3000
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3000";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

/** 与 src/lib/checkin-items.ts 目录同步的 key 白名单 */
const CATALOG_KEYS = new Set([
  "hat_cap", "hat_top", "hat_crown",
  "scarf_knit", "scarf_cloud", "scarf_star",
  "toy_ball", "toy_bone", "toy_wand",
]);

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

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const YESTERDAY = dateStr(new Date(Date.now() - 24 * 3600 * 1000));

(async () => {
  out(`\n=== P0-1 每日签到 + 心情盲盒 E2E（${BASE}）===`);

  const ts = Date.now().toString().slice(-6);
  const email = `ck_${ts}@test.aiabw`;
  const reg = await req("POST", "/api/auth/register", { email, password: "ckpass123" });
  const token = reg.json?.token;
  assert(!!token, "注册测试账号成功");
  const uid = (await q("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;
  await q("UPDATE users SET points = 0 WHERE id = $1", [uid]);

  // 1) 签到状态：新用户
  const s0 = await req("GET", "/api/user/checkin", null, token);
  assert(s0.status === 200 && s0.json?.ok, "GET /api/user/checkin 200");
  assert(
    s0.json?.checkedToday === false && s0.json?.streak === 0 && s0.json?.nextStreak === 1,
    "新用户 checkedToday=false / streak=0 / nextStreak=1",
    JSON.stringify({ c: s0.json?.checkedToday, s: s0.json?.streak, n: s0.json?.nextStreak }),
  );
  assert(s0.json?.premium === false, "非月卡用户 premium=false");
  const sAnon = await req("GET", "/api/user/checkin", null, null);
  assert(sAnon.status === 401, "未登录访问签到状态 → 401", "status=" + sAnon.status);

  // 2) 第 1 天签到：day1 心情（你来啦！）
  const c1 = await req("POST", "/api/user/checkin", {}, token);
  assert(c1.json?.ok && c1.json?.streak === 1, "第 1 天签到 streak=1");
  assert(c1.json?.mood === "day1", "心情档位 day1（你来啦！）", c1.json?.mood);
  assert(c1.json?.pointsGain === 10 && c1.json?.item === null, "普通用户 +10 积分 / 无盲盒道具");
  assert(c1.json?.premium === false, "返回 premium=false");

  // 3) 重复签到幂等
  const c2 = await req("POST", "/api/user/checkin", {}, token);
  assert(c2.json?.ok && c2.json?.already === true && c2.json?.streak === 1, "重复签到 already=true 不重复发分");
  const ptsAfter = (await q("SELECT points FROM users WHERE id=$1", [uid])).rows[0]?.points;
  assert(ptsAfter === 10, "积分只入账一次（10 分）", "points=" + ptsAfter);

  // 4) 第 3 天：day3 心情（老朋友！）
  await q("UPDATE users SET last_checkin_date=$1, checkin_streak=2 WHERE id=$2", [YESTERDAY, uid]);
  const c3 = await req("POST", "/api/user/checkin", {}, token);
  assert(c3.json?.streak === 3 && c3.json?.mood === "day3", "第 3 天心情 day3（老朋友！）", `streak=${c3.json?.streak} mood=${c3.json?.mood}`);
  assert(c3.json?.item === null, "第 3 天无盲盒道具");

  // 5) 第 7 天：day7 心情 + 盲盒道具入库 user_items
  await q("UPDATE users SET last_checkin_date=$1, checkin_streak=6 WHERE id=$2", [YESTERDAY, uid]);
  const c4 = await req("POST", "/api/user/checkin", {}, token);
  assert(c4.json?.streak === 7 && c4.json?.mood === "day7", "第 7 天心情 day7（最好的伙伴）", `streak=${c4.json?.streak} mood=${c4.json?.mood}`);
  assert(c4.json?.bonus === true && c4.json?.bonusPoints === 100, "7 天成就 +100 积分");
  assert(!!c4.json?.item?.key && CATALOG_KEYS.has(c4.json.item.key), "开出目录内道具", JSON.stringify(c4.json?.item));
  assert(["common", "rare", "legendary"].includes(c4.json?.item?.rarity), "道具稀有度合法", c4.json?.item?.rarity);

  const itemRow = (
    await q(
      "SELECT id, item_key, rarity, source, equipped_adoption_id FROM user_items WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [uid],
    )
  ).rows[0];
  assert(
    itemRow?.item_key === c4.json?.item?.key && itemRow?.source === "checkin_blindbox" && itemRow?.equipped_adoption_id === null,
    "user_items 入库：source=checkin_blindbox / 未装备",
    JSON.stringify(itemRow),
  );

  // 6) 月卡：积分翻倍 + 保底稀有（第二个 7 天周期）
  await q(
    "UPDATE users SET premium_until = now() + interval '30 days', last_checkin_date=$1, checkin_streak=13 WHERE id=$2",
    [YESTERDAY, uid],
  );
  const c5 = await req("POST", "/api/user/checkin", {}, token);
  assert(c5.json?.premium === true, "月卡用户 premium=true");
  assert(c5.json?.pointsGain === 20 && c5.json?.bonusPoints === 200, "月卡积分翻倍（20 + 200）", JSON.stringify({ g: c5.json?.pointsGain, b: c5.json?.bonusPoints }));
  assert(
    c5.json?.item?.rarity === "rare" || c5.json?.item?.rarity === "legendary",
    "月卡保底稀有（≥稀有）",
    c5.json?.item?.rarity,
  );
  assert(c5.json?.streak === 14, "连签 14 天（第二个周期）再次开盒", "streak=" + c5.json?.streak);

  // 7) 背包列表
  const inv = await req("GET", "/api/user/items", null, token);
  assert(inv.json?.ok && Array.isArray(inv.json.items) && inv.json.items.length === 2, "背包 2 件道具", "len=" + inv.json?.items?.length);
  const invAnon = await req("GET", "/api/user/items", null, null);
  assert(invAnon.status === 401, "未登录访问背包 → 401", "status=" + invAnon.status);

  // 8) 装备 / 卸下（造一只测试领养宠物）
  const adoptRes = await q(
    "INSERT INTO adoptions (user_id, pet_name, pet_type) VALUES ($1, '签到测试宠', 'fox') RETURNING id",
    [uid],
  );
  const adoptionId = adoptRes.rows[0]?.id;
  const firstItem = inv.json.items[0];
  const eq1 = await req("POST", "/api/user/items/equip", { itemId: firstItem.id, adoptionId }, token);
  assert(
    eq1.json?.ok && eq1.json.items?.some((i) => i.id === firstItem.id && i.equippedAdoptionId === adoptionId),
    "装备道具到宠物成功",
  );
  const eq0 = await req("POST", "/api/user/items/equip", { itemId: firstItem.id, adoptionId: null }, token);
  assert(
    eq0.json?.ok && eq0.json.items?.some((i) => i.id === firstItem.id && i.equippedAdoptionId === null),
    "卸下道具成功",
  );

  // 9) 越权 / 非法参数防护
  const email2 = `ck2_${ts}@test.aiabw`;
  const reg2 = await req("POST", "/api/auth/register", { email: email2, password: "ckpass123" });
  const token2 = reg2.json?.token;
  const steal = await req("POST", "/api/user/items/equip", { itemId: firstItem.id, adoptionId }, token2);
  assert(steal.status === 403 || steal.status === 404, "他人道具装备被拒（403/404）", "status=" + steal.status);
  const badAdopt = await req(
    "POST",
    "/api/user/items/equip",
    { itemId: firstItem.id, adoptionId: "00000000-0000-0000-0000-000000000000" },
    token,
  );
  assert(badAdopt.status === 404, "装备到不存在/非本人的宠物被拒（404）", "status=" + badAdopt.status);
  const badItem = await req("POST", "/api/user/items/equip", { itemId: "not-a-uuid", adoptionId: null }, token);
  assert(badItem.status === 400, "非法 itemId 被拒（400）", "status=" + badItem.status);

  // 清理（按 FK 依赖顺序）
  const uid2 = (await q("SELECT id FROM users WHERE email=$1", [email2])).rows[0]?.id;
  await q("DELETE FROM user_items WHERE user_id = ANY($1::uuid[])", [[uid, uid2]]);
  await q("DELETE FROM points_log WHERE user_id = ANY($1::uuid[])", [[uid, uid2]]);
  await q("DELETE FROM adoptions WHERE user_id = ANY($1::text[])", [[uid, uid2]]);
  await q("DELETE FROM users WHERE id = ANY($1::uuid[])", [[uid, uid2]]);

  out(`\n=== 结果：${pass} passed, ${fail} failed ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => {
  out("FATAL: " + (e?.stack || e?.message || e));
  try { await pool.end(); } catch {}
  process.exit(1);
});
