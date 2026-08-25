// 用户增长引擎 E2E（本地 dev server）：日签 / 裂变防刷 / 排行榜
// 1) 每日签到：首次 +10；同日重复签到拦截（already，不加分）
// 2) 连签 7 天成就：streak=6+今天 → 7，额外 +100
// 3) 裂变：带 ref 注册 → 冻结 pending → 被邀请人领养 → 邀请人 +50
// 4) 恶意刷码拦截：同 IP 24h 第 4 次被拒；自邀请拒绝；重复绑定拒绝
// 5) 排行榜：领养铸造后 /api/leaderboard 实时出现 + 本周繁育计数
// Usage: node scripts/verify-growth.cjs http://localhost:3000
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

async function req(method, apiPath, body, token, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(BASE + apiPath, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...extraHeaders,
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

function yesterday() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const password = "growthpass123";
  const allEmails = [];

  // ---- A) 每日签到：+10 + 重复拦截 ----
  const emailA = `gcheck_${ts}@test.aiabw`;
  allEmails.push(emailA);
  const regA = await req("POST", "/api/auth/register", { email: emailA, password });
  const tokenA = regA.json?.token;
  assert(!!tokenA, "A 注册成功（含新手礼包）");
  assert(regA.json?.welcomeBonus === 20, "注册即得新手礼包 +20");

  const ck1 = await req("POST", "/api/user/checkin", null, tokenA);
  assert(ck1.status === 200 && ck1.json?.already === false, "首次签到成功", "status=" + ck1.status);
  assert(ck1.json?.streak === 1, "首签连签天数 = 1", "streak=" + ck1.json?.streak);
  assert(ck1.json?.points - 20 === 10, "签到 +10 积分", "diff=" + (ck1.json?.points - 20));

  const ck2 = await req("POST", "/api/user/checkin", null, tokenA);
  assert(ck2.json?.already === true, "同日重复签到被拦截（already=true）");
  assert(ck2.json?.points === ck1.json?.points, "重复签到不加分", "points=" + ck2.json?.points);

  // ---- B) 连签 7 天成就：预置 streak=6 + 昨天签到 → 本次 = 7 + 额外 100 ----
  const emailB = `gstreak_${ts}@test.aiabw`;
  allEmails.push(emailB);
  const regB = await req("POST", "/api/auth/register", { email: emailB, password });
  const tokenB = regB.json?.token;
  const uidB = (await pool.query("SELECT id FROM users WHERE email=$1", [emailB])).rows[0]?.id;
  await pool.query(
    `UPDATE users SET last_checkin_date=$1, checkin_streak=6, points=0 WHERE id=$2`,
    [yesterday(), uidB],
  );
  const ckB = await req("POST", "/api/user/checkin", null, tokenB);
  assert(ckB.json?.streak === 7, "连签第 7 天 streak=7", "streak=" + ckB.json?.streak);
  assert(ckB.json?.bonus === true, "第 7 天触发签到成就（bonus=true）");
  assert(ckB.json?.points === 110, "连签 7 天 +10+100 = 110", "points=" + ckB.json?.points);

  // ---- C) 裂变：带 ref 注册 → 冻结 pending → 被邀请人领养后邀请人 +50 ----
  const inviter = `ginviter_${ts}@test.aiabw`;
  allEmails.push(inviter);
  const regInv = await req("POST", "/api/auth/register", { email: inviter, password });
  const uidInv = (await pool.query("SELECT id FROM users WHERE email=$1", [inviter])).rows[0]?.id;
  const inviteCode = regInv.json?.user?.inviteCode;
  assert(/^[A-Z0-9]{6}$/.test(inviteCode), "邀请码为 6 位大写字母+数字", "code=" + inviteCode);
  const invPoints0 = (await pool.query("SELECT points FROM users WHERE id=$1", [uidInv])).rows[0].points;

  const invited = `ginvited_${ts}@test.aiabw`;
  allEmails.push(invited);
  const regInvited = await req(
    "POST",
    "/api/auth/register",
    { email: invited, password, ref: inviteCode.toLowerCase(), deviceId: "dev-inv-" + ts },
    null,
    { "x-forwarded-for": "10.1.1.1" },
  );
  assert(regInvited.json?.invitedBy === uidInv, "被邀请人绑定邀请关系（大小写不敏感）");
  assert(regInvited.json?.invitePending === true, "邀请奖励进入冻结状态（pending）");
  const invPoints1 = (await pool.query("SELECT points FROM users WHERE id=$1", [uidInv])).rows[0].points;
  assert(invPoints1 === invPoints0, "活跃验证前邀请奖励冻结（邀请人积分未变）", `p0=${invPoints0} p1=${invPoints1}`);

  const tokenInvited = regInvited.json?.token;
  const cat = await req("GET", "/api/pets/catalog?limit=60");
  const freePet = (cat.json?.pets || []).find((p) => !p.owned);
  assert(!!freePet, "图鉴池有未领养宠物");
  const claimInvited = await req("POST", "/api/pets/claim", { petId: freePet.id }, tokenInvited);
  assert(claimInvited.status === 200, "被邀请人完成首次领养", "status=" + claimInvited.status);
  await wait(2000);
  const invPoints2 = (await pool.query("SELECT points FROM users WHERE id=$1", [uidInv])).rows[0].points;
  assert(invPoints2 === invPoints0 + 50, "活跃验证通过后邀请人 +50", `p2=${invPoints2} expect=${invPoints0 + 50}`);
  const irRow = (await pool.query(
    `SELECT status FROM invite_rewards WHERE invited_user_id=(SELECT id FROM users WHERE email=$1)`,
    [invited],
  )).rows[0];
  assert(irRow?.status === "credited", "invite_rewards 状态置为 credited", "status=" + irRow?.status);

  // ---- D) 恶意刷邀请码拦截 ----
  const selfBind = await req("POST", "/api/referral/bind", { code: inviteCode }, regInv.json?.token);
  assert(selfBind.status === 400, "不能绑定自己的邀请码（400）", "status=" + selfBind.status);
  const dupBind = await req("POST", "/api/referral/bind", { code: inviteCode }, tokenInvited);
  assert(dupBind.status === 409, "已绑定用户重复绑定被拒（409）", "status=" + dupBind.status);
  const badBind = await req("POST", "/api/referral/bind", { code: "ZZZZZZ" }, tokenA);
  assert(badBind.status === 404, "无效邀请码（404）", "status=" + badBind.status);
  let ipLimitHit = false;
  for (let i = 1; i <= 4; i++) {
    const fake = `gip_${ts}_${i}@test.aiabw`;
    allEmails.push(fake);
    const r = await req(
      "POST",
      "/api/auth/register",
      { email: fake, password, ref: inviteCode, deviceId: `dev-ip-${ts}-${i}` },
      null,
      { "x-forwarded-for": "10.9.9.9" },
    );
    if (i === 4 && r.json?.invitePending === false) ipLimitHit = true;
  }
  assert(ipLimitHit, "同 IP 24h 内第 4 次邀请奖励被防刷拦截");

  // ---- E) 排行榜实时更新 ----
  const lbPets = await req("GET", "/api/leaderboard?type=pets");
  assert(lbPets.status === 200 && Array.isArray(lbPets.json?.items), "全服最强榜接口可用");
  assert(lbPets.json?.items.length <= 20, "榜单最多 20 条", "n=" + lbPets.json?.items.length);
  const myCollectible = (await pool.query(
    `SELECT hash_id FROM user_collectibles WHERE owner_id=(SELECT id FROM users WHERE email=$1) LIMIT 1`,
    [invited],
  )).rows[0];
  const inList = lbPets.json?.items.some((x) => x.hashId === myCollectible?.hash_id);
  assert(inList, "领养铸造的宠物实时出现在全服最强榜");
  const powers = lbPets.json?.items.map((x) => x.power);
  const sorted = powers.every((p, i) => i === 0 || powers[i - 1] >= p);
  assert(sorted, "榜单按战力降序排序");

  const lbBreeders = await req("GET", "/api/leaderboard?type=breeders");
  assert(lbBreeders.status === 200 && Array.isArray(lbBreeders.json?.items), "繁育达人榜接口可用");
  const uidInvited = (await pool.query("SELECT id FROM users WHERE email=$1", [invited])).rows[0]?.id;
  const invBreed = lbBreeders.json?.items.find((x) => x.ownerId === uidInvited);
  assert(invBreed && invBreed.mintedCount >= 1, "本周繁育达人榜包含刚领养的用户（mintedCount≥1）");

  // ---- 清理 ----
  for (const email of allEmails) {
    const u = (await pool.query("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;
    if (!u) continue;
    await pool.query(`DELETE FROM invite_rewards WHERE inviter_id=$1 OR invited_user_id=$1`, [u]);
    await pool.query(`DELETE FROM user_collectibles WHERE owner_id=$1`, [u]);
    await pool.query(
      `DELETE FROM adoptions WHERE user_id=$1::text OR thread_id IN (SELECT id FROM threads WHERE user_id=$1::text)`,
      [u],
    );
    await pool.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id=$1::text)`, [u]);
    await pool.query(`DELETE FROM threads WHERE user_id=$1::text`, [u]);
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
