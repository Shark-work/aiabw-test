// 三项修复验证：1) 中文语言切换完整性  2) 品牌名 AIABW/艾比世界  3) 访问计数
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
const innerText = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const pg = await browser.newPage();
  // 真实 Chrome UA（puppeteer headless 的 HeadlessChrome 会被 /api/visits 的 Bot 过滤拦截）
  await pg.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  );
  await pg.setViewport({ width: 1440, height: 900 });
  let pageErr = null;
  pg.on("pageerror", (e) => {
    pageErr = String(e);
    console.log("  WARN pageerror:", String(e).slice(0, 140));
  });

  // ---- 1) 中文语言切换：5+ 核心页面完整中文 ----
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pg.evaluate(() => (document.cookie = "NEXT_LOCALE=zh; path=/; max-age=86400; SameSite=Lax"));
  const zhPages = ["/zh", "/zh/pets", "/zh/pets/my", "/zh/marketplace", "/zh/points", "/zh/my-pets", "/zh/handbooks"];
  for (const p of zhPages) {
    await pg.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 30000 });
    await wait(1500);
    const txt = await innerText(pg);
    const hasNavZh = txt.includes("首页") && txt.includes("动物图鉴") && txt.includes("我的宠物");
    const hasEnglishLeak = /Sign in|Create your|Adopt|Encyclopedia/i.test(txt) && !txt.includes("获得它");
    const empty = txt.replace(/\s/g, "").length < 80;
    assert(hasNavZh && !empty, p + " 中文导航完整（无空白/无乱码）");
    assert(!hasEnglishLeak, p + " 无明显英文残留（Sign in/Create 等）");
  }

  // 切换器：在 /zh/pets 点「中文」（已是中文，验证 lang 稳定）→ 再验证等价页面
  await pg.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1200);
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll("header button")].find((x) => x.innerText.includes("🌐"));
    if (b) b.click();
  });
  await wait(400);
  await pg.evaluate(() => {
    const it = [...document.querySelectorAll("header [role='menu'] button")].find((x) => x.innerText.includes("中文"));
    if (it) it.click();
  });
  await wait(1500);
  const zhSwitched = await pg.evaluate(() => ({ path: location.pathname, lang: document.documentElement.lang }));
  console.log("  switch to zh:", JSON.stringify(zhSwitched));
  assert(zhSwitched.path === "/zh/pets" && zhSwitched.lang === "zh", "切换中文 → /zh/pets + lang=zh（等价页面）");
  // ---- 2) 品牌名：AIABW（en）/ 艾比世界（zh）----
  await pg.goto(BASE + "/en", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1500);
  const enTxt = await innerText(pg);
  assert(enTxt.includes("AIABW"), "英文页显示品牌 AIABW");
  assert(!/Aibi World|Abi World/i.test(enTxt), "英文页无旧品牌名 Aibi World/Abi World");
  const enTitle = await pg.title();
  console.log("  en title:", enTitle);
  assert(/AIABW/.test(enTitle), "英文 <title> 含 AIABW");
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1200);
  const zhTxt = await innerText(pg);
  assert(zhTxt.includes("艾比世界"), "中文页显示品牌 艾比世界");
  assert(!zhTxt.includes("Abi World"), "中文页无旧英文品牌 Abi World");

  // ---- 3) 访问计数：Footer 展示 + 递增 + 千分位 + 防刷 ----
  // reset 仅 dev 可用（生产返回 404，忽略后从现有计数开始验证）
  await fetch(BASE + "/api/visits/admin/reset").catch(() => {});
  await wait(300);
  const v1 = await fetch(BASE + "/api/visits").then((r) => r.json());
  console.log("  visits#1:", JSON.stringify(v1));
  assert(v1.ok && typeof v1.total === "number" && v1.total >= 1, "访问计数接口正常（total ≥ 1）");
  const v2 = await fetch(BASE + "/api/visits").then((r) => r.json());
  console.log("  visits#2:", JSON.stringify(v2));
  assert(v2.ok && v2.total === v1.total, "同 IP 60s 内重复请求不计数（防刷）");
  const v3 = await fetch(BASE + "/api/visits", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  }).then((r) => r.json());
  assert(v3.ok && v3.total === v1.total, "Bot UA 不计数");
  // 浏览器首次访问 visits API：设置 aiabw_visitor Cookie（后续刷新为老访客计数）
  await pg.goto(BASE + "/api/visits", { waitUntil: "domcontentloaded", timeout: 20000 });
  await wait(300);
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2200);
  const foot = await pg.evaluate(() => {
    const m = document.body.innerText.match(/本站累计访问 ([0-9,]+) 次/);
    return { text: m ? m[0] : null, total: m ? m[1] : null };
  });
  console.log("  footer visits:", JSON.stringify(foot));
  assert(foot.text !== null && parseInt(String(foot.total).replace(/,/g, ""), 10) >= 10000, "页脚显示访问计数（+10000 底数，千分位）");
  await pg.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2200);
  const foot2 = await pg.evaluate(() => {
    const m = document.body.innerText.match(/本站累计访问 ([0-9,]+) 次/);
    return m ? m[1] : null;
  });
  console.log("  footer visits after reload:", foot2);
  assert(foot2 !== null && foot2 !== foot.total, "刷新后访问数递增");

  // ---- 4) not-found 中文/英文 ----
  await pg.goto(BASE + "/zh/this-page-does-not-exist", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1200);
  const zh404 = await innerText(pg);
  assert(zh404.includes("页面未找到") || zh404.includes("返回首页"), "zh 404 页中文文案");
  await pg.goto(BASE + "/en/this-page-does-not-exist", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(1200);
  const en404 = await innerText(pg);
  assert(en404.includes("Page not found") || en404.includes("Back to home"), "en 404 页英文文案");

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});

