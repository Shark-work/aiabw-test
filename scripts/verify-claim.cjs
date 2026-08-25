// 核心领养功能 E2E（本地 dev server）：图鉴领养三条路径
// 1) 免费领养：新用户 claim 图鉴宠物 → 200 + petType=species:* + 专属线程创建
// 2) 付费拦截：第二只 → 402 PET_LIMIT_REACHED + needPayment + unlockAdoptionId
// 3) UI 知识弹窗：图鉴页点「获得它」→ 祝贺动画 + 宠物知识百科弹窗（含互动引导）
// 4) 无限领养：模拟支付回调（users.is_unlocked=true）→ 再领养放行
// Usage: node scripts/verify-claim.cjs http://localhost:3000
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { Pool } = require("@neondatabase/serverless");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
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

  // ---- 0) 图鉴数据源：取 2 只未领养宠物 ----
  const cat = await req("GET", "/api/pets/catalog?limit=60");
  assert(cat.status === 200 && cat.json?.ok, "图鉴接口可用", "status=" + cat.status);
  const poolPets = (cat.json?.pets || []).filter((p) => !p.owned);
  assert(poolPets.length >= 2, "图鉴池有至少 2 只未领养宠物", "n=" + poolPets.length);
  const [P1, P2] = poolPets;

  // ---- A) 免费领养（新用户第 1 只）----
  const emailA = `claim_${ts}@test.aiabw`;
  const regA = await req("POST", "/api/auth/register", { email: emailA, password: "claimpass123" });
  const tokenA = regA.json?.token;
  assert(!!tokenA, "A 注册成功");

  const claim1 = await req("POST", "/api/pets/claim", { petId: P1.id }, tokenA);
  console.log("  claim#1 ->", claim1.status, JSON.stringify(claim1.json || claim1.text).slice(0, 160));
  assert(claim1.status === 200 && claim1.json?.ok, "免费领养第 1 只成功（200）", "status=" + claim1.status);
  const petType1 = claim1.json?.adoption?.petType || "";
  assert(/^species:[a-z0-9_]+$/.test(petType1), "adoption.petType 编码为 species:<id>", "petType=" + petType1);
  assert(!!claim1.json?.threadId && !!claim1.json?.adoption?.id, "创建专属对话线程 + 领养记录");
  assert(claim1.json?.pet?.speciesName, "返回宠物展示信息（知识弹窗数据源）");

  // 幂等/防重复领养：同一只宠物再次 claim → 410
  const dup = await req("POST", "/api/pets/claim", { petId: P1.id }, tokenA);
  assert(dup.status === 410, "同一只宠物不能被重复领养（410）", "status=" + dup.status);

  // ---- B) 付费拦截（第 2 只 → 402）----
  const claim2 = await req("POST", "/api/pets/claim", { petId: P2.id }, tokenA);
  console.log("  claim#2 ->", claim2.status, JSON.stringify(claim2.json || claim2.text).slice(0, 160));
  assert(
    claim2.status === 402 &&
      claim2.json?.code === "PET_LIMIT_REACHED" &&
      claim2.json?.needPayment === true,
    "第 2 只触发付费拦截（402 PET_LIMIT_REACHED）",
    "status=" + claim2.status,
  );
  assert(!!claim2.json?.unlockAdoptionId, "402 返回 unlockAdoptionId（支付目标宠物）");

  // ---- D) 模拟支付回调 → 无限领养 ----
  await pool.query("UPDATE users SET is_unlocked = true WHERE email = $1", [emailA]);
  const afterUnlock = await req("POST", "/api/pets/claim", { petId: P2.id }, tokenA);
  console.log("  claim#2 after unlock ->", afterUnlock.status);
  assert(afterUnlock.status === 200 && afterUnlock.json?.ok, "支付解锁后第 2 只领养放行（无限领养）");

  // ---- C) UI：图鉴页点「获得它」→ 祝贺动画 + 知识百科弹窗 ----
  const emailB = `claimui_${ts}@test.aiabw`;
  const regB = await req("POST", "/api/auth/register", { email: emailB, password: "claimpass123" });
  const tokenB = regB.json?.token;
  assert(!!tokenB, "B 注册成功");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: "C:\\p2tmp\\pptr-verify-claim",
    args: ["--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-dev-shm-usage"],
  });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 40000 });
  await pg.evaluate((tk) => localStorage.setItem("aiabw_token", tk), tokenB);
  await pg.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 40000 });

  // 等待图鉴卡片渲染 + 点击「获得它」按钮（dev 冷编译 catalog 较慢）
  let getBtnClicked = false;
  for (let i = 0; i < 50; i++) {
    const clicked = await pg.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter(
        (b) => b.innerText.includes("获得它") && !b.disabled,
      );
      if (btns.length === 0) return false;
      btns[0].click();
      return true;
    });
    if (clicked) { getBtnClicked = true; break; }
    await wait(600);
  }
  assert(getBtnClicked, "UI 点击「获得它」按钮成功");

  // 等待祝贺动画 + 知识弹窗出现
  let sawCelebrate = false;
  let sawKnowledge = false;
  for (let i = 0; i < 30; i++) {
    const r = await pg.evaluate(() => ({
      celebrate: document.body.innerText.includes("领养成功"),
      knowledge: document.body.innerText.includes("宠物知识百科"),
      hasInteract: document.body.innerText.includes("如何与它互动"),
      hasSpecies: document.body.innerText.includes("真实物种百科"),
      hasTrait: document.body.innerText.includes("AI 性格标签"),
    }));
    if (r.celebrate) sawCelebrate = true;
    if (r.knowledge) sawKnowledge = r.knowledge && r.hasInteract && r.hasSpecies && r.hasTrait;
    if (sawKnowledge) break;
    await wait(400);
  }
  assert(sawCelebrate, "领养成功祝贺动画出现");
  assert(sawKnowledge, "宠物知识百科弹窗出现（物种百科+性格标签+互动引导）");
  await pg
    .evaluate(() => {
      const close = [...document.querySelectorAll("button")].find((b) =>
        b.innerText.includes("稍后再说"),
      );
      close?.click();
    })
    .catch(() => {});
  await browser.close();

  // ---- 清理测试数据（还原 pets 池 + 删除领养/线程/消息）----
  const uidQ = await pool.query("SELECT id FROM users WHERE email = $1", [emailA]);
  const uidA = uidQ.rows[0]?.id;
  if (uidA) {
    await pool.query(
      `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id = $1)`,
      [uidA],
    );
    await pool.query(`DELETE FROM adoptions WHERE user_id = $1`, [uidA]);
    await pool.query(`DELETE FROM threads WHERE user_id = $1`, [uidA]);
    await pool.query(
      `UPDATE pets SET owner_id = NULL, adopted_at = NULL, last_interaction_time = NULL WHERE owner_id = $1`,
      [uidA],
    );
  }
  const uidQ2 = await pool.query("SELECT id FROM users WHERE email = $1", [emailB]);
  const uidB = uidQ2.rows[0]?.id;
  if (uidB) {
    await pool.query(
      `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE user_id = $1)`,
      [uidB],
    );
    await pool.query(`DELETE FROM adoptions WHERE user_id = $1`, [uidB]);
    await pool.query(`DELETE FROM threads WHERE user_id = $1`, [uidB]);
    await pool.query(
      `UPDATE pets SET owner_id = NULL, adopted_at = NULL, last_interaction_time = NULL WHERE owner_id = $1`,
      [uidB],
    );
  }

  await pool.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
