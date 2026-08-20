// Capture the exact 404 resource + page errors on the live site.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  page.on("response", (res) => {
    if (res.status() >= 400) {
      console.log("HTTP " + res.status() + " -> " + res.url());
    }
  });
  page.on("requestfailed", (req) => {
    console.log("REQFAILED: " + req.url() + "  err=" + (req.failure() && req.failure().errorText));
  });
  page.on("pageerror", (err) => {
    console.log("PAGEERROR: " + (err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : err));
  });
  await page.goto("https://www.aiabw.com/zh", { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
