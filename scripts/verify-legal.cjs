// Verify legal pages render (desktop + mobile) and footer has the 3 legal links.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";
const PAGES = ["/zh/legal/terms", "/zh/legal/privacy", "/zh/legal/virtual-goods"];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const fails = [];

  // footer 链接检查（在首页）
  const home = await browser.newPage();
  await home.setViewport({ width: 1440, height: 900 });
  await home.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1500));
  const footerLinks = await home.evaluate(() => Array.from(document.querySelectorAll("footer a")).map((a) => a.getAttribute("href")));
  console.log("footer links:", JSON.stringify(footerLinks));
  const need = ["/zh/legal/terms", "/zh/legal/privacy", "/zh/legal/virtual-goods"];
  for (const n of need) if (!footerLinks.includes(n)) fails.push("footer missing " + n);
  await home.close();

  for (const p of PAGES) {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 1440, height: 900 });
    let crashed = false;
    pg.on("pageerror", () => { crashed = true; });
    const status = await pg.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 25000 }).then((r) => r.status()).catch((e) => "ERR:" + e.message);
    await new Promise((r) => setTimeout(r, 1200));
    const info = await pg.evaluate(() => {
      const t = document.body.innerText;
      return {
        title: document.querySelector("h1")?.innerText?.slice(0, 30) ?? null,
        bodyLen: t.length,
        hasKey: t.includes("退款") || t.includes("refund") || t.includes("隐私") || t.includes("Privacy") || t.includes("服务协议") || t.includes("Terms"),
      };
    });
    console.log(`[${p}] status=${status} crash=${crashed} title=${info.title} bodyLen=${info.bodyLen} hasKey=${info.hasKey}`);
    if (status !== 200 || crashed || info.bodyLen < 300 || !info.hasKey) fails.push(`${p}: status=${status} crash=${crashed} len=${info.bodyLen}`);
    await pg.close();
  }

  // virtual-goods 关键条款断言
  const goods = await browser.newPage();
  await goods.setViewport({ width: 1440, height: 900 });
  await goods.goto(BASE + "/zh/legal/virtual-goods", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1200));
  const g = await goods.evaluate(() => {
    const t = document.body.innerText;
    return {
      noRefund: t.includes("不支持退款"),
      transparent: t.includes("公开透明") && t.includes("3:1"),
      recover: t.includes("负责核实并恢复数据") || t.includes("恢复"),
      noResale: t.includes("禁止任何形式的线下倒卖"),
    };
  });
  console.log("virtual-goods clauses:", JSON.stringify(g));
  if (!g.noRefund || !g.transparent || !g.recover || !g.noResale) fails.push("virtual-goods missing key clauses");
  await goods.close();

  // 移动端：mobile viewport 渲染
  const mob = await browser.newPage();
  await mob.setViewport({ width: 375, height: 720 });
  const mStatus = await mob.goto(BASE + "/zh/legal/virtual-goods", { waitUntil: "domcontentloaded", timeout: 25000 }).then((r) => r.status());
  await new Promise((r) => setTimeout(r, 1200));
  const mobInfo = await mob.evaluate(() => ({ w: window.innerWidth, hasArticle: !!document.querySelector("article"), bodyLen: document.body.innerText.length }));
  console.log("[mobile virtual-goods]", JSON.stringify(mobInfo));
  if (mStatus !== 200 || !mobInfo.hasArticle) fails.push("mobile legal page broken");
  await mob.close();

  console.log("FAILURES: " + (fails.length ? fails.join(" | ") : "none ✅"));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
