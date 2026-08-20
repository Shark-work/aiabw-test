// E2E: login -> adopt 2nd pet -> upgrade modal -> pay/create returns QR (200), not 401.
// Usage: node scripts/test-pay-flow.cjs [baseUrl]
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "https://www.aiabw.com";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let payCreateStatus = null;
  let payCreateAuth = false;
  page.on("request", (req) => {
    if (req.url().includes("/api/pay/create")) {
      payCreateAuth = (req.headers().authorization || "").startsWith("Bearer ");
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/pay/create")) payCreateStatus = res.status();
  });
  let crashed = false;
  page.on("pageerror", () => { crashed = true; });

  // 1) login
  await page.goto(BASE + "/zh/login", { waitUntil: "networkidle2", timeout: 45000 });
  await page.type('input[type="email"]', "qapay_6969222@test.aiabw");
  await page.type('input[type="password"]', "qapass2026");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 3000));
  console.log("logged_in page=" + page.url());

  // 2) 点第一个可领养宠物卡片
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const adoptBtn = btns.find((b) => b.textContent && /抱抱狐|小企鹅|修勾|Huggy Fox|Penguin|Rover/.test(b.textContent));
    if (adoptBtn) { adoptBtn.click(); return true; }
    return false;
  });
  console.log("adopt_clicked=" + clicked);
  await new Promise((r) => setTimeout(r, 8000));

  // 3) 检查结果
  const hasQr = await page.evaluate(() => document.body.innerText.includes("扫码") || document.body.innerText.includes("二维码") || !!document.querySelector("svg"));
  const hasSignInErr = await page.evaluate(() => document.body.innerText.includes("请先登录") || document.body.innerText.includes("signInFirst"));
  console.log("payCreateStatus=" + payCreateStatus + " authSent=" + payCreateAuth + " hasQr=" + hasQr + " signInErr=" + hasSignInErr + " crashed=" + crashed);
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
