// 盲盒前端状态隔离验证：点击一个盲盒的开箱按钮，另一个按钮不受影响（不 disabled/不显示开箱中）
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const BASE = process.argv[2] || "http://localhost:3000";

(async () => {
  if (!chromePath) {
    console.error("NO_CHROME");
    process.exit(2);
  }
  // 注册测试账号并充值（足够积分走 points 通道，避免支付弹窗干扰）
  const email = `bxs_${Date.now().toString().slice(-6)}@test.aiabw`;
  const reg = await fetch(BASE + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "bxspass123" }),
  }).then((r) => r.json());
  const token = reg.token;
  if (!token) {
    console.error("REG_FAIL", JSON.stringify(reg));
    process.exit(2);
  }
  const env = fs.readFileSync("scripts/../.env", "utf8");
  const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
  const { Pool } = require("@neondatabase/serverless");
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });
  const uid = (await pool.query("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
  await pool.query("UPDATE users SET points = 10000 WHERE id = $1", [uid]);
  await pool.end();

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2000 });
  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((tk) => {
    localStorage.setItem("aiabw_token", tk);
  }, token);
  await page.reload({ waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 8000));

  // 找到两个盲盒「抽一发」按钮
  const btns = await page.evaluate(() => {
    const out = [];
    const all = Array.from(document.querySelectorAll("button"));
    for (const b of all) {
      if (b.textContent && b.textContent.includes("抽一发")) {
        out.push({ text: b.textContent.trim(), disabled: b.disabled });
      }
    }
    return out;
  });
  console.log("draw buttons before:", JSON.stringify(btns));
  if (btns.length < 2) {
    console.error("NOT_ENOUGH_BUTTONS");
    process.exit(2);
  }

  // 点击第一个盲盒的抽一发
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button"));
    const b = all.find((x) => x.textContent && x.textContent.includes("抽一发"));
    b.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  const after = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button"));
    const states = all.filter((b) => b.textContent && (b.textContent.includes("开箱中") || b.textContent.includes("抽一发"))).map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }));
    return states;
  });
  console.log("draw buttons during draw:", JSON.stringify(after));

  const drawingCount = after.filter((b) => b.textContent.includes("开箱中") || (b.textContent.includes("抽一发") && b.disabled)).length;
  const freeCount = after.filter((b) => b.textContent.includes("抽一发") && !b.disabled).length;
  console.log(`RESULT: drawing/disabled=${drawingCount}, independent&enabled=${freeCount} ${drawingCount === 1 && freeCount >= 1 ? "ALL PASS (状态隔离)" : "FAILED"}`);

  // 清理账号
  try {
    await (await fetch(BASE + "/api/auth/register", { method: "POST" })).text();
  } catch {}
  await browser.close();
  process.exit(drawingCount === 1 && freeCount >= 1 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
