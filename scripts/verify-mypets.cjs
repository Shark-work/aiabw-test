// 我的宠物页 PRD 场景自检（puppeteer-core 浏览器 E2E + SQL 数据准备）
// 用户视角：新用户，300 积分，合成组 x3 + 互斥组 x2
// 覆盖：聚合卡片 xN → 仅显示可合成 → 子选择层勾选 → 互斥置灰 → 底部操作台
//       → 合成仪式动画 → 结果页 → 放生二次确认 → 兑换所进度条/不足可点/兑换/每日限次
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { Pool } = require("@neondatabase/serverless");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const innerText = (page) => page.evaluate(() => document.body.innerText);
async function waitForText(page, text, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await innerText(page);
    if (t.includes(text)) return true;
    await wait(250);
  }
  return false;
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const email = `mypets_${ts}@test.aiabw`;
  const reg = await fetch(BASE + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "mypetspass123" }),
  }).then((r) => r.json());
  if (!reg?.token) {
    console.log("register failed:", JSON.stringify(reg).slice(0, 200));
    process.exit(2);
  }
  console.log("user:", email);

  // 数据准备：300 积分 + 动态选物种（合成组 x3 + 互斥组 x2）
  await pool.query("UPDATE users SET points = 300 WHERE email = $1", [email]);
  const { rows: freePool } = await pool.query(
    `SELECT species_id, count(*)::int AS n FROM pets
       WHERE owner_id IS NULL AND status='active' AND traits->>'rarity'='common'
       GROUP BY species_id HAVING count(*) >= 3 ORDER BY n DESC LIMIT 6`,
  );
  if (!freePool.length) {
    console.log("no species with 3+ unowned common pets");
    process.exit(2);
  }
  const synthSp = freePool[0].species_id;
  let otherSp = freePool.find((s) => s.species_id !== synthSp)?.species_id;
  if (!otherSp) {
    const r2 = await pool.query(
      `SELECT species_id FROM pets WHERE owner_id IS NULL AND status='active'
         AND species_id != $1 AND traits->>'rarity'='common'
         GROUP BY species_id HAVING count(*) >= 2 LIMIT 1`,
      [synthSp],
    );
    otherSp = r2.rows[0]?.species_id;
  }
  if (!otherSp) {
    console.log("no second species for mutex test");
    process.exit(2);
  }
  const assign = async (species, n) => {
    const r = await pool.query(
      `SELECT id FROM pets WHERE owner_id IS NULL AND status='active' AND species_id=$1
         AND traits->>'rarity'='common' ORDER BY random() LIMIT $2`,
      [species, n],
    );
    if (r.rows.length !== n) {
      console.log("not enough unowned " + species + ": " + r.rows.length + "/" + n);
      process.exit(2);
    }
    await pool.query(
      `UPDATE pets SET owner_id=(SELECT id FROM users WHERE email=$1), adopted_at=now() WHERE id=ANY($2)`,
      [email, r.rows.map((x) => x.id)],
    );
    return r.rows.map((x) => x.id);
  };
  const synthIds = await assign(synthSp, 3);
  const otherIds = await assign(otherSp, 2);
  console.log("prepared: synth", synthSp, "x3 | other", otherSp, "x2");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  let pageErr = null;
  pg.on("pageerror", (e) => {
    pageErr = String(e);
    console.log("  WARN pageerror:", String(e).slice(0, 160));
  });

  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pg.evaluate((tk) => localStorage.setItem("aiabw_token", tk), reg.token);
  await pg.goto(BASE + "/zh/pets/my", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(3600);

  // 1) 顶部状态栏 + 聚合卡片
  let txt = await innerText(pg);
  assert(txt.includes("我的宠物"), "页面标题「我的宠物」");
  assert(/持有\s*5\s*\/\s*100/.test(txt.replace(/\s/g, " ")), "持有数 5/100");
  const cards = await pg.$$eval("button", (btns) =>
    btns
      .filter((b) => /x[0-9]+/.test(b.innerText) && !/返回图鉴/.test(b.innerText))
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()),
  );
  assert(cards.some((c) => c.includes("x3")), "聚合卡片：存在 x3 角标");
  assert(cards.some((c) => c.includes("x2")), "聚合卡片：存在 x2 角标");
  assert(cards.length === 2, "仅 2 张聚合卡片（同类聚合）");

  // 2) 仅显示可合成开关
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("仅显示可合成"));
    if (b) b.click();
  });
  await wait(300);
  txt = await innerText(pg);
  assert(!txt.includes("x2"), "「仅显示可合成」后 x2 组隐藏");
  assert(txt.includes("x3"), "「仅显示可合成」后 x3 组保留");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("仅显示可合成"));
    if (b) b.click();
  });
  await wait(300);
  // 3) 子选择层：点击 x3 聚合卡片 → 勾选 3 只
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("x3"));
    if (b) b.click();
  });
  await wait(400);
  txt = await innerText(pg);
  assert(txt.includes("选择要合成的伙伴"), "子选择层打开（标题）");

  // 勾选 2 只 → 底部操作台不出现
  await pg.evaluate(() => {
    const rows = [...document.querySelectorAll("button")].filter(
      (b) => b.innerText.trim() && b.querySelector("img") && b.closest("[class*='rounded-xl']"),
    );
    rows.slice(0, 2).forEach((b) => b.click());
  });
  await wait(400);
  txt = await innerText(pg);
  assert(!txt.includes("立即合成"), "勾选 2 只时底部操作台未出现");
  assert(txt.includes("2/3"), "计数显示 2/3");

  // 勾选第 3 只 → 底部操作台出现
  await pg.evaluate(() => {
    const rows = [...document.querySelectorAll("button")].filter(
      (b) => b.innerText.trim() && b.querySelector("img") && b.closest("[class*='rounded-xl']"),
    );
    rows[2].click();
  });
  await wait(400);
  txt = await innerText(pg);
  assert(txt.includes("已选中 3 只"), "底部操作台：已选中 3 只");
  assert(txt.includes("立即合成"), "底部操作台：立即合成按钮");

  // 4) 互斥：关闭子选择层后，x2 组卡片置灰
  await pg.evaluate(() => {
    const close = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "×");
    if (close) close.click();
  });
  await wait(400);
  const disabledCards = await pg.$$eval("button", (btns) =>
    btns.filter((b) => b.disabled && b.innerText.includes("x2")).length,
  );
  assert(disabledCards >= 1, "互斥：勾选后 x2 组卡片置灰禁用");

  // 5) 合成仪式
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("立即合成"));
    if (b) b.click();
  });
  assert(await waitForText(pg, "融合中", 4000), "合成仪式：融合中文案");
  const anim = await pg.evaluate(() => ({
    fuse: !!document.querySelector(".fuse-l, .fuse-m, .fuse-r"),
    burst: !!document.querySelector(".fuse-burst"),
    silhouette: !!document.querySelector(".blur-\\[2px\\]"),
  }));
  assert(anim.fuse, "合成仪式：汇聚动画元素");
  assert(anim.burst, "合成仪式：强光扩散元素");
  assert(anim.silhouette, "合成仪式：剪影元素");
  assert(await waitForText(pg, "放入背包", 10000), "结果页：出现（放入背包按钮）");
  txt = await innerText(pg);
  assert(
    txt.includes("基因重组成功") || txt.includes("奇迹发生") || txt.includes("更高形态"),
    "结果页：合成文案（普通/暴击）",
  );
  assert(txt.includes("继续合成"), "结果页：继续合成按钮");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("放入背包"));
    if (b) b.click();
  });
  await wait(400);

  // 6) 放生：合成组剩 x1 → 子选择层 → 🗑️ → 二次确认
  await pg.goto(BASE + "/zh/pets/my", { waitUntil: "domcontentloaded", timeout: 30000 });
  assert(await waitForText(pg, "x1", 9000), "合成后该物种剩 x1");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("x1"));
    if (b) b.click();
  });
  await wait(400);
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("title") === "🗑️ 放生");
    if (b) b.click();
  });
  await wait(300);
  txt = await innerText(pg);
  assert(txt.includes("确定要放生这只") && txt.includes("此操作不可撤销"), "放生二次确认文案（防呆）");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.innerText.includes("🗑️ 放生") && x.className.includes("bg-red-500"),
    );
    if (b) b.click();
  });
  assert(await waitForText(pg, "已放生", 6000), "放生成功 toast");
  // 7) 积分兑换所：300 分进度条 + 不足不置灰 + 积分不足提示
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("积分兑换所"));
    if (b) b.click();
  });
  await wait(400);
  txt = await innerText(pg);
  assert(txt.includes("还差 200 分即可兑换"), "进度条文案：还差 200 分即可兑换");
  const redeemDisabled = await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.innerText.includes("兑换新伙伴"),
    );
    return b ? b.disabled : "missing";
  });
  assert(redeemDisabled === false, "积分不足但兑换按钮不置灰（损失厌恶）");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.innerText.includes("兑换新伙伴"),
    );
    if (b) b.click();
  });
  assert(await waitForText(pg, "积分不足", 6000), "点击兑换后提示积分不足");

  // 8) 充值 500 → 兑换成功 → 存入
  await pool.query("UPDATE users SET points = 500 WHERE email = $1", [email]);
  await pg.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(3000);
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("积分兑换所"));
    if (b) b.click();
  });
  await wait(400);
  txt = await innerText(pg);
  assert(txt.includes("500 / 500") || txt.includes("500/500"), "充值后进度条满");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.innerText.includes("兑换新伙伴"),
    );
    if (b) b.click();
  });
  assert(await waitForText(pg, "兑换成功", 8000), "兑换成功弹窗");
  assert(await waitForText(pg, "存入我的宠物", 3000), "存入我的宠物按钮");
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("存入我的宠物"));
    if (b) b.click();
  });
  await wait(600);

  // 9) 每日限次：再次兑换 → 429
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("积分兑换所"));
    if (b) b.click();
  });
  await wait(400);
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("兑换新伙伴"));
    if (b) b.click();
  });
  assert(await waitForText(pg, "明天", 6000) || (await innerText(pg)).includes("每天"), "每日限次 429 提示");

  // 清理测试宠物（放回池）
  await pool.query(
    `UPDATE pets SET owner_id=NULL, adopted_at=NULL WHERE owner_id=(SELECT id FROM users WHERE email=$1) AND status='active'`,
    [email],
  );

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  await pool.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});


