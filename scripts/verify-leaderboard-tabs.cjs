// 排行榜 tab 切换竞态回归：collection（CountItem）→ popularity（PetItem）切换不得白屏。
// 事故（2026-10-16）：setCategory 同步重渲先于 useEffect，旧 items 在新分类分支渲染一帧 → TypeError。
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const url = process.argv[2] || "http://localhost:3100/zh/leaderboard";
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let crashed = false;
  page.on("pageerror", (err) => {
    crashed = true;
    console.log("PAGEERROR: " + String(err && err.message ? err.message : err).slice(0, 200));
  });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('[data-testid="cat-tab-collection"]', { timeout: 20000 });
  // 等 popularity 首载数据到达
  await page.waitForSelector('[data-testid="rank-card-1"]', { timeout: 20000 }).catch(() => {});
  // 切到 collection（计数榜）
  await page.click('[data-testid="cat-tab-collection"]');
  await new Promise((r) => setTimeout(r, 2500));
  // 切回 popularity —— 事故触发路径
  await page.click('[data-testid="cat-tab-popularity"]');
  await new Promise((r) => setTimeout(r, 400)); // 事故帧窗口
  const midErr = await page.evaluate(() => document.body.innerText.includes("Application error"));
  console.log("mid-switch crashed=" + crashed + " applicationError=" + midErr);
  await new Promise((r) => setTimeout(r, 2500));
  const cards = await page.evaluate(() => document.querySelectorAll('[data-testid^="rank-card-"]').length);
  const bodyErr = await page.evaluate(() => document.body.innerText.includes("Application error"));
  console.log("final rank-cards=" + cards + " applicationError=" + bodyErr + " crashed=" + crashed);
  await browser.close();
  process.exit(crashed || midErr || bodyErr || cards === 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL: " + (e && e.stack ? e.stack.split("\n").slice(0, 5).join("\n") : e.message));
  process.exit(2);
});
