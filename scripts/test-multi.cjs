// Test multiple LIVE pages in headless Chrome; report crash status.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  for (const path of process.argv.slice(2)) {
    const url = "https://www.aiabw.com" + path;
    let crashed = false;
    const onErr = (err) => { crashed = true; console.log("  PAGEERROR " + path + ": " + String(err).slice(0, 150)); };
    page.on("pageerror", onErr);
    try {
      const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      const hasAppErr = await page.evaluate(() => document.body.innerText.includes("Application error")).catch(() => true);
      console.log(path + " status=" + res.status() + " crashed=" + crashed + " appError=" + hasAppErr);
    } catch (e) {
      console.log(path + " NAVERR: " + e.message.slice(0, 100));
    }
    page.off("pageerror", onErr);
  }
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
