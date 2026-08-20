// Check /zh/pets renders pet cards (species names + rarity badges + imprint).
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";

(async () => {
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let crashed = false;
  page.on("pageerror", () => { crashed = true; });
  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await page.goto(BASE + "/zh/pets", { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasCards: /金毛|雪豹|缅因猫|海豚|蓝鲸|柯基|企鹅/.test(text),
      hasRarityBadge: /传说|史诗|稀有|不凡|常见/.test(text),
      hasImprint: /孕育|Born for you/.test(text),
      hasIdPattern: /#[0-9A-F]{6}/.test(text),
      hasSynthesize: text.includes("合成"),
      hasShare: text.includes("名片"),
    };
  });
  console.log("crashed=" + crashed + " " + JSON.stringify(info));
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
