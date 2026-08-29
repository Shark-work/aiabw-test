// 统计脚本真实浏览器验证：监听 googletagmanager / hm.baidu 网络请求 + window 全局
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

(async () => {
  if (!chromePath) {
    console.error("NO_CHROME");
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--user-data-dir=" + fs.mkdtempSync(require("os").tmpdir() + "\\pup-"),
    ],
  });
  const page = await browser.newPage();
  const hits = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("googletagmanager.com") || u.includes("hm.baidu.com")) hits.push(u.slice(0, 90));
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.includes("googletagmanager.com") || u.includes("hm.baidu.com"))
      hits.push("FAILED: " + u.slice(0, 90) + " (" + r.failure()?.errorText + ")");
  });

  await page.goto("http://localhost:3000/zh", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 9000));

  const gtagFn = await page.evaluate(() => typeof window.gtag === "function");
  const hmtArr = await page.evaluate(() => Array.isArray(window._hmt));
  const dataLayer = await page.evaluate(() => Array.isArray(window.dataLayer));

  console.log("window.gtag:", gtagFn, "| window._hmt:", hmtArr, "| window.dataLayer:", dataLayer);
  console.log("network hits:");
  for (const h of hits) console.log("  " + h);
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
