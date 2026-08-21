// Verify support contact features: footer <address>, floating button (panel/copy), chat-page hidden, legal support module, mobile sizing.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const fails = [];

  // ---- home: footer address + floating button ----
  const home = await browser.newPage();
  await home.setViewport({ width: 1440, height: 900 });
  await home.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2000));
  const homeInfo = await home.evaluate(() => {
    const addr = document.querySelector("footer address");
    const floatBtn = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label")?.includes("客服") || b.innerText.includes("🎧"));
    return {
      hasAddress: !!addr,
      addrText: addr?.innerText?.replace(/\s+/g, " ").slice(0, 90) ?? null,
      hasMailto: !!addr?.querySelector('a[href^="mailto:"]'),
      floatBtn: !!floatBtn,
    };
  });
  console.log("[home]", JSON.stringify(homeInfo));
  if (!homeInfo.hasAddress || !homeInfo.hasMailto || !homeInfo.floatBtn) fails.push("home footer/float broken");

  // ---- open floating panel ----
  await home.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.includes("🎧"));
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const panel = await home.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasPanel: t.includes("意见反馈与客服联系") || t.includes("Feedback & Support"),
      hasEmail: t.includes("1206309834@qq.com"),
      hasGroup: t.includes("1005445619"),
      hasCopyBtn: Array.from(document.querySelectorAll("button")).some((b) => b.innerText.includes("复制") || b.innerText.includes("Copy")),
    };
  });
  console.log("[panel]", JSON.stringify(panel));
  if (!panel.hasPanel || !panel.hasEmail || !panel.hasGroup || !panel.hasCopyBtn) fails.push("floating panel broken");
  await home.close();

  // ---- chat page: hidden ----
  const chat = await browser.newPage();
  await chat.setViewport({ width: 1440, height: 900 });
  await chat.goto(BASE + "/zh/chat", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2000));
  const chatHidden = await chat.evaluate(() => !Array.from(document.querySelectorAll("button")).some((b) => b.innerText.includes("🎧")));
  console.log("[chat] floatHidden=" + chatHidden);
  if (!chatHidden) fails.push("floating button not hidden on /chat");
  await chat.close();

  // ---- legal pages: support module ----
  for (const p of ["/zh/legal/terms", "/zh/legal/virtual-goods"]) {
    const pg = await browser.newPage();
    await pg.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 1500));
    const m = await pg.evaluate(() => {
      const t = document.body.innerText;
      return { hasModule: t.includes("意见反馈与客服联系"), hasEmail: t.includes("1206309834@qq.com"), hasGroup: t.includes("1005445619") };
    });
    console.log("[" + p + "]", JSON.stringify(m));
    if (!m.hasModule || !m.hasEmail || !m.hasGroup) fails.push(p + " support module missing");
    await pg.close();
  }

  // ---- mobile: floating button smaller (h-12 vs h-14) ----
  const mob = await browser.newPage();
  await mob.setViewport({ width: 375, height: 720 });
  await mob.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2000));
  const mobInfo = await mob.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.includes("🎧"));
    const rect = btn?.getBoundingClientRect();
    return { size: rect ? Math.round(rect.width) : 0, fitsRight: rect ? rect.right <= 375 : false };
  });
  console.log("[mobile] floatBtn", JSON.stringify(mobInfo));
  if (!mobInfo.size || mobInfo.size > 50 || !mobInfo.fitsRight) fails.push("mobile float button sizing broken");
  await mob.close();

  console.log("FAILURES: " + (fails.length ? fails.join(" | ") : "none ✅"));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
