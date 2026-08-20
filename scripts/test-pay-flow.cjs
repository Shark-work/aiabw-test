// E2E (reliable): login via API -> inject token -> adopt 2nd pet -> modal -> pay/create = 200 + QR.
// Usage: node scripts/test-pay-flow.cjs [baseUrl]
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "https://www.aiabw.com";

(async () => {
  // 1) API 登录拿 token
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  if (!login?.token) { console.log("login FAILED: " + JSON.stringify(login).slice(0, 120)); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let payCreateStatus = null;
  let payCreateAuth = false;
  page.on("request", (req) => {
    if (req.url().includes("/api/pay/create")) {
      payCreateAuth = (req.headers().authorization || "").startsWith("Bearer ");
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/pay/create")) {
      payCreateStatus = res.status();
      if (res.status() >= 400) console.log("  pay/create body: " + (await res.text().catch(() => "")).slice(0, 250));
    }
  });
  let crashed = false;
  page.on("pageerror", () => { crashed = true; });

  // 2) 注入 token 后进入首页
  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await page.goto(BASE + "/zh", { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));

  // 3) 点可领养宠物卡片
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((x) => x.textContent && /抱抱狐|小企鹅|修勾|Huggy Fox|Penguin|Rover/.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  });
  console.log("adopt_clicked=" + clicked);
  await new Promise((r) => setTimeout(r, 8000));

  const hasQr = await page.evaluate(() => document.body.innerText.includes("扫码") || document.body.innerText.includes("二维码") || !!document.querySelector("svg"));
  const hasSignInErr = await page.evaluate(() => document.body.innerText.includes("请先登录"));
  console.log("payCreateStatus=" + payCreateStatus + " authSent=" + payCreateAuth + " hasQr=" + hasQr + " signInErr=" + hasSignInErr + " crashed=" + crashed);
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
