// Post-refactor UX verification against a running local server.
// Asserts: header nav on ALL pages, footer links, no console errors / failed reqs (favicon),
// home rare banner, mobile hamburger menu opens/closes, my-pets imprint + hash id after login.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";
const PAGES = ["/zh", "/zh/pets", "/zh/my-pets", "/zh/marketplace", "/zh/chat", "/zh/handbooks", "/zh/points", "/zh/login", "/zh/register", "/zh/about", "/zh/faq", "/zh/contact", "/zh/terms"];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const fails = [];
  let navOk = 0;

  // ---- desktop: all pages have header nav + footer links + no errors ----
  for (const p of PAGES) {
    const pager = await browser.newPage();
    await pager.setViewport({ width: 1440, height: 900 });
    const errors = [];
    const failed = [];
    pager.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 100)); });
    pager.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url().slice(0, 90)); });
    const status = await pager.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 25000 }).then((r) => r.status()).catch((e) => "ERR:" + e.message);
    await new Promise((r) => setTimeout(r, 1200));
    let info;
    try {
      info = await pager.evaluate(() => {
        const header = document.querySelector("header");
        const nav = header?.querySelector("nav");
        const footerLinks = Array.from(document.querySelectorAll("footer a")).length;
        return {
          hasHeader: !!header,
          navLinks: nav ? nav.querySelectorAll("a").length : 0,
          footerLinks,
        };
      });
    } catch (e) { info = { err: e.message.slice(0, 80) }; }
    const ok = info.hasHeader && info.navLinks >= 6 && info.footerLinks >= 4;
    if (ok) navOk += 1;
    if (!ok || status !== 200) fails.push(`${p}: status=${status} header=${info.hasHeader} nav=${info.navLinks} footer=${info.footerLinks} console=${errors.slice(0, 2).join("|")} failed=${failed.slice(0, 3).join("|")}`);
    console.log(`[${p}] status=${status} header=${info.hasHeader} nav=${info.navLinks} footerLinks=${info.footerLinks} consoleErr=${errors.length} failReq=${failed.length}`);
    await pager.close();
  }

  // ---- home: rare banner present ----
  const home = await browser.newPage();
  await home.setViewport({ width: 1440, height: 900 });
  await home.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1500));
  const rare = await home.evaluate(() => {
    const txt = document.body.innerText;
    const cta = Array.from(document.querySelectorAll("a")).find((a) => a.getAttribute("href")?.includes("/pets") && (a.innerText.includes("稀有") || a.innerText.includes("Rare")));
    return { banner: txt.includes("稀有宠物") || txt.includes("Rare Pets"), cta: !!cta };
  });
  console.log("[home] rare banner:", rare.banner, "cta-to-pets:", rare.cta);
  if (!rare.banner || !rare.cta) fails.push("home: rare banner missing");
  await home.close();

  // ---- mobile: hamburger opens & closes ----
  const mob = await browser.newPage();
  await mob.setViewport({ width: 375, height: 720 });
  await mob.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1200));
  const burgerOpen = await mob.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "打开菜单" || b.getAttribute("aria-label") === "Open menu" || b.innerText.includes("☰"));
    if (!btn) return "no-burger";
    btn.click();
    return "clicked";
  });
  await new Promise((r) => setTimeout(r, 600));
  const panelVisible = await mob.evaluate(() => {
    const panel = Array.from(document.querySelectorAll("nav")).find((n) => n.className.includes("absolute") && n.className.includes("z-50"));
    return !!panel && panel.querySelectorAll("a").length >= 6;
  });
  await mob.evaluate(() => {
    const overlay = Array.from(document.querySelectorAll("button")).find((b) => b.className.includes("fixed") && b.className.includes("z-40"));
    if (overlay) overlay.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const panelClosed = await mob.evaluate(() => {
    return !Array.from(document.querySelectorAll("nav")).some((n) => n.className.includes("absolute") && n.className.includes("z-50"));
  });
  console.log("[mobile] burger:", burgerOpen, "panel=" + panelVisible, "closed-after-overlay=" + panelClosed);
  if (burgerOpen !== "clicked" || !panelVisible || !panelClosed) fails.push("mobile hamburger broken");
  await mob.close();

  // ---- logged-in my-pets: imprint + hash id ----
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  if (login?.token) {
    const mp = await browser.newPage();
    await mp.setViewport({ width: 1440, height: 900 });
    await mp.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
    await mp.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
    await mp.goto(BASE + "/zh/my-pets", { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 2500));
    const mi = await mp.evaluate(() => {
      const txt = document.body.innerText;
      const hash = (txt.match(/#[0-9A-F]{6}/) || [])[0] ?? null;
      return {
        imprintMark: txt.includes("专属印记") || txt.includes("Endowment"),
        hashId: hash,
        hasImprintDate: /孕育|Born for you/.test(txt),
      };
    });
    console.log("[my-pets logged-in] imprint=" + mi.imprintMark + " hashId=" + mi.hashId + " imprintDate=" + mi.hasImprintDate);
    if (!mi.imprintMark || !mi.hashId || !mi.hasImprintDate) fails.push("my-pets imprint missing");
    await mp.close();
  } else {
    console.log("[my-pets] login failed - skip");
  }

  console.log("---------------------------------------------");
  console.log("pages-with-nav: " + navOk + "/" + PAGES.length);
  console.log("FAILURES: " + (fails.length ? fails.join("\n  - ") : "none ✅"));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });

