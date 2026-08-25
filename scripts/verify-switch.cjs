// 语言切换真实行为验证（双向 + query + 首页 + server 内容刷新）
// 覆盖此前断言缺陷：必须从「非当前语言」真实切换，验证 URL / lang / 导航 / Footer 文案完整刷新
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function switchTo(page, langLabel, fromPath) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("header button")].find((b) => b.innerText.includes("🌐"));
    if (btn) btn.click();
  });
  await wait(400);
  await page.evaluate((label) => {
    const it = [...document.querySelectorAll("header [role='menu'] button")].find((x) => x.innerText.includes(label));
    if (it) it.click();
  }, langLabel);
  // 轮询等待硬跳转完成（dev 首次编译目标语言可能较慢；导航中 context 销毁属正常）
  for (let i = 0; i < 40; i++) {
    try {
      const p = await page.evaluate(() => location.pathname);
      if (p !== fromPath) break;
    } catch {
      // 导航中 ExecutionContext 被销毁，忽略后继续等待
    }
    await wait(250);
  }
  await wait(800);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  let pageErr = null;
  pg.on("pageerror", (e) => {
    pageErr = String(e);
    console.log("  WARN pageerror:", String(e).slice(0, 140));
  });

  // ---- 1) zh → en（/zh/pets → /en/pets，server 内容刷新）----
  await pg.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1800);
  await switchTo(pg, "English", "/zh/pets");
  const zh2en = await pg.evaluate(() => ({
    path: location.pathname,
    lang: document.documentElement.lang,
    txt: document.body.innerText,
    title: document.title,
  }));
  console.log("--- zh→en ---");
  console.log("  url:", zh2en.path, "| lang:", zh2en.lang, "| title:", zh2en.title);
  assert(zh2en.path === "/en/pets", "目标 URL 正确拼接 /en/pets（非 /zh）");
  assert(zh2en.lang === "en", "<html lang=en> 已更新");
  assert(zh2en.title.includes("AIABW"), "英文 <title> 加载（metaTitle en）");
  assert(/Animal Encyclopedia|Pets/.test(zh2en.txt) && !zh2en.txt.includes("动物图鉴"), "英文导航渲染且无中文导航残留");
  assert(zh2en.txt.includes("Total Visits") || zh2en.txt.includes("AIABW. All Rights Reserved"), "Footer server 文案已刷新为英文");

  // ---- 2) en → zh（/en/pets → /zh/pets）----
  await switchTo(pg, "中文", "/en/pets");
  const en2zh = await pg.evaluate(() => ({
    path: location.pathname,
    lang: document.documentElement.lang,
    txt: document.body.innerText,
  }));
  console.log("--- en→zh ---");
  console.log("  url:", en2zh.path, "| lang:", en2zh.lang);
  assert(en2zh.path === "/zh/pets", "目标 URL 正确拼接 /zh/pets");
  assert(en2zh.lang === "zh", "<html lang=zh> 已更新");
  assert(en2zh.txt.includes("动物图鉴") && en2zh.txt.includes("我的宠物"), "中文导航渲染");
  assert(en2zh.txt.includes("本站累计访问") || en2zh.txt.includes("© 2026 艾比世界"), "Footer server 文案已刷新为中文");

  // ---- 3) 带 query 切换（/zh/pets?species=X → /en/pets?species=X）----
  await pg.goto(BASE + "/zh/pets?species=golden_retriever", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1800);
  await switchTo(pg, "English", "/zh/pets");
  const qs = await pg.evaluate(() => location.pathname + location.search);
  console.log("--- query switch ---");
  console.log("  url:", qs);
  assert(qs === "/en/pets?species=golden_retriever", "query 参数保留且语言前缀正确（/en/pets?species=golden_retriever）");

  // ---- 4) 首页切换（/zh → /en）----
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1800);
  await switchTo(pg, "English", "/zh");
  const home = await pg.evaluate(() => location.pathname);
  console.log("--- home switch ---");
  console.log("  url:", home);
  assert(home === "/en", "首页切换 /zh → /en（默认英文 locale 前缀）");

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
