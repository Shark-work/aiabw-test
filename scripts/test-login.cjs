// End-to-end login flow test on the live site: login -> redirect -> check no crash.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let crashed = false;
  page.on("pageerror", (err) => { crashed = true; console.log("PAGEERROR: " + String(err).slice(0, 200)); });
  try {
    await page.goto("https://www.aiabw.com/zh/login", { waitUntil: "networkidle2", timeout: 45000 });
    console.log("login page loaded, crashed=" + crashed);
    // 填写登录表单
    await page.type('input[type="email"]', "qapay_6969222@test.aiabw");
    await page.type('input[type="password"]', "qapass2026");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await new Promise((r) => setTimeout(r, 4000));
    const hasAppErr = await page.evaluate(() => document.body.innerText.includes("Application error")).catch(() => true);
    const url = page.url();
    console.log("after login url=" + url + " crashed=" + crashed + " appError=" + hasAppErr);
  } catch (e) {
    console.log("FLOWERR: " + e.message.slice(0, 160));
  }
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
