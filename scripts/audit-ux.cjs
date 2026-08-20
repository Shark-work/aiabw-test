// Global layout / UX audit against production. Collects, per page:
// console errors, failed HTTP requests, title, h1, presence of nav/header/footer,
// broken images, and all same-origin links (dead-link check).
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "https://www.aiabw.com";
const PAGES = ["/zh", "/zh/pets", "/zh/my-pets", "/zh/marketplace", "/zh/chat", "/zh/handbooks", "/zh/points", "/zh/login", "/zh/register"];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const allLinks = new Set();
  const results = [];

  for (const p of PAGES) {
    const errors = [];
    const failed = [];
    const pager = await browser.newPage();
    await pager.setViewport({ width: 1440, height: 900 });
    pager.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    pager.on("requestfailed", (r) => failed.push(r.url().slice(0, 160)));
    pager.on("response", (r) => {
      if (r.status() >= 400) failed.push(r.status() + " " + r.url().slice(0, 180));
    });
    let crashed = false;
    pager.on("pageerror", () => { crashed = true; });

    const status = await pager.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 30000 }).then((r) => r.status()).catch((e) => "ERR:" + e.message);
    await new Promise((r) => setTimeout(r, 1500));

    let info;
    try {
      info = await pager.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
        const imgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length;
        return {
          title: document.title,
          h1: document.querySelector("h1")?.innerText?.slice(0, 60) ?? null,
          hasNav: !!document.querySelector("nav"),
          hasHeader: !!document.querySelector("header"),
          hasFooter: !!document.querySelector("footer"),
          footerLinks: Array.from(document.querySelectorAll("footer a")).map((a) => a.getAttribute("href")).join(","),
          topText: document.body.innerText.slice(0, 140).replace(/\s+/g, " "),
          brokenImages: imgs,
          links,
        };
      });
    } catch (e) {
      info = { evaluateError: e.message.slice(0, 90), links: [] };
    }
    info.links.filter((l) => l && (l.startsWith("/") || l.startsWith(BASE))).forEach((l) => allLinks.add(l));
    results.push({ page: p, status, crashed, errors: errors.slice(0, 4), failed: failed.slice(0, 6), ...info, links: undefined });
    await pager.close();
  }

  // dead-link check (HEAD-ish GET on same-origin paths, excluding /api and _next), parallel with limit
  const dead = [];
  const candidates = Array.from(allLinks).filter(
    (l) => !l.includes("/api/") && !l.includes("_next") && !l.includes("#") && !/\.(webp|png|svg|jpg|jpeg|gif|ico)$/.test(l),
  );
  const CONC = 6;
  const runOne = async (l) => {
    const url = l.startsWith("/") ? BASE + l : l;
    try {
      const r = await fetch(url, { method: "GET", redirect: "manual" });
      if (r.status >= 400 && r.status !== 401) dead.push(r.status + " " + url);
    } catch {
      dead.push("ERR " + url);
    }
  };
  for (let i = 0; i < candidates.length; i += CONC) {
    await Promise.all(candidates.slice(i, i + CONC).map(runOne));
  }

  console.log("=== GLOBAL UX AUDIT ===");
  for (const r of results) {
    console.log("---------------------------------------------");
    console.log(`[${r.page}] status=${r.status} crash=${r.crashed}`);
    console.log(`  title: ${r.title}`);
    console.log(`  h1: ${r.h1}`);
    console.log(`  nav=${r.hasNav} header=${r.hasHeader} footer=${r.hasFooter} brokenImg=${r.brokenImages}`);
    console.log(`  footerLinks: ${r.footerLinks}`);
    console.log(`  consoleErrors: ${r.errors.length ? r.errors.join(" | ") : "none"}`);
    console.log(`  failedReqs: ${r.failed.length ? r.failed.join(" | ") : "none"}`);
    console.log(`  topText: ${r.topText}`);
  }
  console.log("---------------------------------------------");
  console.log(`TOTAL links found: ${allLinks.size}`);
  console.log("DEAD LINKS: " + (dead.length ? dead.join(" | ") : "none ✅"));
  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
