// 页脚排版 + 访问计数 + 品牌验证
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

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  let pageErr = null;
  pg.on("pageerror", (e) => {
    pageErr = String(e);
    console.log("  WARN pageerror:", String(e).slice(0, 140));
  });

  // ---- zh 页脚（默认折叠：仅版权行 + 展开按钮）----
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(800);
  const zhFolded = await pg.evaluate(() => {
    const foot = document.querySelector("footer");
    const btn = foot?.querySelector("button[aria-expanded]");
    return {
      t: foot?.innerText ?? "",
      btnText: (btn?.innerText ?? "").trim(),
      expanded: btn?.getAttribute("aria-expanded") ?? null,
      // 折叠内容保留在 DOM（SEO 保障，未条件卸载）
      navInDom: !!foot?.querySelector("nav a"),
      legalInDom: (foot?.textContent ?? "").includes("受著作权法保护"),
    };
  });
  console.log("--- zh footer（折叠态）---");
  console.log("  text:", JSON.stringify(zhFolded.t.slice(0, 120)));
  console.log("  button:", JSON.stringify(zhFolded.btnText), "aria-expanded:", zhFolded.expanded);
  assert(zhFolded.t.includes("© 2025-2026 艾比世界 (AIABW). All Rights Reserved."), "折叠态：主版权行始终显示");
  assert(zhFolded.expanded === "false", "折叠态：按钮 aria-expanded=false");
  assert(zhFolded.btnText.includes("展开") && zhFolded.btnText.includes("▸"), "折叠态：按钮文案「展开 ▸」");
  assert(!zhFolded.t.includes("关于我们") && !zhFolded.t.includes("受著作权法保护"), "折叠态：链接组/法律条款默认视觉隐藏");
  assert(zhFolded.navInDom && zhFolded.legalInDom, "折叠态：内容保留在 DOM（SEO 可抓取）");
  // 点击展开按钮
  await pg.evaluate(() => { document.querySelector("footer button[aria-expanded]")?.click(); });
  // 轮询等待访问计数渲染（dev 首次编译较慢）
  for (let i = 0; i < 30; i++) {
    const has = await pg.evaluate(() => (document.querySelector("footer")?.innerText ?? "").includes("本站累计访问"));
    if (has) break;
    await wait(300);
  }
  await wait(500);
  const zh = await pg.evaluate(() => {
    const foot = document.querySelector("footer");
    const t = foot?.innerText ?? "";
    return {
      t,
      // 版权行加粗（font-semibold）
      boldCopyright: !!foot?.querySelector("p.font-semibold"),
      // 法律条款字号
      noticeClass: [...(foot?.querySelectorAll("p") ?? [])].map((p) => p.className),
      expanded: foot?.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") ?? null,
      btnText: (foot?.querySelector("button[aria-expanded]")?.innerText ?? "").trim(),
    };
  });
  console.log("--- zh footer（展开态）---");
  console.log("  classes:", JSON.stringify(zh.noticeClass));
  assert(zh.expanded === "true" && zh.btnText.includes("收起") && zh.btnText.includes("▾"), "展开态：按钮切换「收起 ▾」且 aria-expanded=true");
  assert(zh.t.includes("© 2025-2026 艾比世界 (AIABW). All Rights Reserved."), "版权行（艾比世界 + AIABW）加粗保留");
  assert(zh.boldCopyright, "版权行为加粗（font-semibold）");
  assert(zh.t.includes("关于我们") && zh.t.includes("虚拟物品与充值规则"), "展开态：链接组完整显示");
  assert(zh.t.includes("受著作权法保护") && zh.t.includes("不具备现实货币价值"), "法律免责条款存在");
  assert(zh.noticeClass.some((c) => c.includes("text-[11px]") && c.includes("leading-snug") && c.includes("text-slate-500")), "法律条款 text-[11px] + leading-snug + 浅灰");
  assert(zh.t.includes("📊 本站累计访问 10,"), "访问计数显示 +10000 底数（10,xxx）");
  assert(!zh.t.includes("独立访客"), "已隐藏独立访客数据");
  assert(!/Abi World|Aibi World/.test(zh.t), "无 Abi World 品牌残留");

  // ---- en 页脚（默认折叠）----
  await pg.goto(BASE + "/en", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(800);
  const enFolded = await pg.evaluate(() => {
    const foot = document.querySelector("footer");
    const btn = foot?.querySelector("button[aria-expanded]");
    return {
      t: foot?.innerText ?? "",
      btnText: (btn?.innerText ?? "").trim(),
      expanded: btn?.getAttribute("aria-expanded") ?? null,
    };
  });
  console.log("--- en footer（折叠态）---");
  console.log("  text:", JSON.stringify(enFolded.t.slice(0, 120)));
  assert(enFolded.t.includes("© 2025-2026 AIABW. All Rights Reserved."), "en 折叠态：版权行始终显示");
  assert(enFolded.expanded === "false" && enFolded.btnText.includes("Expand") && enFolded.btnText.includes("▸"), "en 折叠态：按钮「Expand ▸」aria-expanded=false");
  assert(!enFolded.t.includes("About") && !enFolded.t.includes("Total visits"), "en 折叠态：链接组/计数默认隐藏");
  // 点击展开按钮
  await pg.evaluate(() => { document.querySelector("footer button[aria-expanded]")?.click(); });
  // 轮询等待访问计数渲染
  for (let i = 0; i < 30; i++) {
    const has = await pg.evaluate(() => (document.querySelector("footer")?.innerText ?? "").includes("Total visits"));
    if (has) break;
    await wait(300);
  }
  await wait(500);
  const enBtn = await pg.evaluate(() => {
    const btn = document.querySelector("footer button[aria-expanded]");
    return { text: (btn?.innerText ?? "").trim(), expanded: btn?.getAttribute("aria-expanded") ?? null };
  });
  const en = await pg.evaluate(() => document.querySelector("footer")?.innerText ?? "");
  console.log("--- en footer（展开态）---");
  assert(enBtn.expanded === "true" && enBtn.text.includes("Collapse") && enBtn.text.includes("▾"), "en 展开态：按钮切换「Collapse ▾」aria-expanded=true");
  assert(en.includes("© 2025-2026 AIABW. All Rights Reserved."), "英文版权行 AIABW");
  assert(en.includes("📊 Total visits: 10,"), "英文访问计数（+10000 底数）");
  assert(!en.includes("Unique Visitors"), "英文无独立访客");
  assert(!/Abi World|Aibi World/.test(en), "英文无 Abi World 残留");

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
