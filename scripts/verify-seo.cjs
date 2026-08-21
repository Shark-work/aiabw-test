// 全球化 SEO/GEO E2E 验证：
// 1) <html lang>（SSR + 客户端切换后动态更新）
// 2) hreflang：自引用 + zh/en 双向对称 + x-default 兜底
// 3) canonical 自引用
// 4) JSON-LD：全局 WebSite/Organization + 图鉴 ItemList/BreadcrumbList
// 5) 语言切换器：Header 最右侧、原生名（中文/English）、下拉、等价页面跳转
// 6) /sitemap.xml 与 /robots.txt 正常
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";
const SITE = "https://www.aiabw.com";

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

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  let pageErr = null;
  pg.on("pageerror", (e) => {
    pageErr = String(e);
    console.log("  WARN pageerror:", String(e).slice(0, 160));
  });

  // ---- 1) /zh/pets：lang + hreflang + canonical + JSON-LD ----
  await pg.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);
  const zh = await pg.evaluate(() => ({
    htmlLang: document.documentElement.lang,
    hreflangs: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => ({
      hl: l.getAttribute("hreflang"),
      href: l.getAttribute("href"),
    })),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
    jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
      try {
        const d = JSON.parse(s.textContent || "{}");
        return d["@type"] + (d.name ? ":" + d.name : "");
      } catch {
        return "BAD_JSON";
      }
    }),
    headerLangText: [...document.querySelectorAll("header button")].some((b) => b.innerText.includes("中文")),
    headerHasGlobe: [...document.querySelectorAll("header button")].some((b) => b.innerText.includes("🌐")),
    footerHasNoSwitcher: ![...document.querySelectorAll("footer button")].some((b) => b.innerText.includes("中文")),
  }));
  console.log("--- /zh/pets ---");
  console.log("  htmlLang:", zh.htmlLang);
  console.log("  hreflang:", JSON.stringify(zh.hreflangs));
  console.log("  canonical:", zh.canonical);
  console.log("  jsonld:", zh.jsonld.join(" | "));
  assert(zh.htmlLang === "zh", "<html lang=\"zh\">");
  const zhHl = zh.hreflangs.map((h) => h.hl).sort();
  assert(zhHl.includes("zh") && zhHl.includes("en") && zhHl.includes("x-default"), "hreflang 含 zh/en/x-default（自引用）");
  const zhHref = (hl) => zh.hreflangs.find((h) => h.hl === hl)?.href ?? "";
  assert(zhHref("zh") === SITE + "/zh/pets", "zh hreflang → /zh/pets（等价页面）");
  assert(zhHref("en") === SITE + "/en/pets", "en hreflang → /en/pets（双向对称）");
  assert(zh.canonical === SITE + "/zh/pets", "canonical 自引用 /zh/pets");
  assert(zh.jsonld.some((t) => t.startsWith("WebSite")), "JSON-LD WebSite（全局）");
  assert(zh.jsonld.some((t) => t.startsWith("ItemList")), "JSON-LD ItemList（图鉴物种）");
  assert(zh.jsonld.some((t) => t.startsWith("BreadcrumbList")), "JSON-LD BreadcrumbList");
  assert(zh.headerLangText && zh.headerHasGlobe, "Header 最右侧：🌐 中文（原生名按钮）");
  assert(zh.footerHasNoSwitcher, "Footer 已无语言切换器（迁移至 Header）");
  // ---- 2) /en/pets：对称 hreflang + lang=en ----
  await pg.goto(BASE + "/en/pets", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);
  const en = await pg.evaluate(() => ({
    htmlLang: document.documentElement.lang,
    hreflangs: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute("href")),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
  }));
  console.log("--- /en/pets ---");
  console.log("  htmlLang:", en.htmlLang);
  console.log("  hreflang:", JSON.stringify(en.hreflangs));
  console.log("  canonical:", en.canonical);
  assert(en.htmlLang === "en", "<html lang=\"en\">");
  assert(en.hreflangs.includes(SITE + "/en/pets"), "en 页 hreflang 自引用");
  assert(en.hreflangs.includes(SITE + "/zh/pets"), "en 页 hreflang 含 zh（双向对称）");
  assert(en.canonical === SITE + "/en/pets", "canonical 自引用 /en/pets");

  // ---- 3) 语言切换器：下拉 + 等价页面 + html lang 动态更新 ----
  await pg.evaluate(() => {
    const btn = [...document.querySelectorAll("header button")].find((b) => b.innerText.includes("🌐"));
    if (btn) btn.click();
  });
  await wait(400);
  const menu = await pg.evaluate(() => {
    const items = [...document.querySelectorAll("header [role='menu'] button")].map((b) => b.innerText.trim());
    return { items, htmlLang: document.documentElement.lang };
  });
  console.log("--- switcher menu ---");
  console.log("  items:", JSON.stringify(menu.items));
  assert(menu.items.length === 2, "下拉列出 2 种语言");
  assert(menu.items.some((i) => i.includes("中文")) && menu.items.some((i) => i.includes("English")), "原生名：中文 / English");
  // 点击 English → 跳到 /en/pets（等价页面，非首页）+ html lang 变 en
  await pg.evaluate(() => {
    const item = [...document.querySelectorAll("header [role='menu'] button")].find((b) => b.innerText.includes("English"));
    if (item) item.click();
  });
  await wait(1500);
  const switched = await pg.evaluate(() => ({
    path: location.pathname,
    htmlLang: document.documentElement.lang,
  }));
  console.log("  after switch:", JSON.stringify(switched));
  assert(switched.path === "/en/pets", "切换后跳转等价页面 /en/pets（非首页）");
  assert(switched.htmlLang === "en", "切换后 <html lang> 动态更新为 en");

  // ---- 4) sitemap.xml + robots.txt ----
  const sm = await fetch(BASE + "/sitemap.xml").then((r) => r.text());
  assert(sm.includes("<urlset"), "sitemap.xml 存在且为 urlset");
  assert(sm.includes(SITE + "/zh/") && sm.includes(SITE + "/en/"), "sitemap 覆盖 /zh/ 与 /en/");
  assert(sm.includes(SITE + "/zh/pets") && sm.includes(SITE + "/en/pets"), "sitemap 含图鉴双语言 URL");
  const rb = await fetch(BASE + "/robots.txt").then((r) => r.text());
  console.log("  robots.txt:", rb.split("\n").filter(Boolean).join(" | "));
  assert(rb.includes("Sitemap:") && rb.includes("/sitemap.xml"), "robots.txt 声明 Sitemap");

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});

