// Test a URL in headless Chrome, report page errors + status.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const url = process.argv[2] || "http://localhost:3100/zh";
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let crashed = false;
  page.on("pageerror", (err) => {
    crashed = true;
    console.log("PAGEERROR: " + (err && err.stack ? err.stack.split("\n").slice(0, 8).join("\n") : err));
  });
  try {
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    console.log("URL=" + url + " status=" + res.status() + " crashed=" + crashed);
    await new Promise((r) => setTimeout(r, 2000));
    // 读取页面标题或错误信息
    const title = await page.title().catch(() => "?");
    const bodyHasError = await page.evaluate(() => document.body.innerText.includes("Application error")).catch(() => false);
    console.log("title=" + title + " bodyHasApplicationError=" + bodyHasError);
  } catch (e) {
    console.log("URL=" + url + " NAVERR: " + e.message.slice(0, 120));
  }
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
