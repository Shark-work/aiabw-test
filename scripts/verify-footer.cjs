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

  // ---- zh 页脚 ----
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  // 轮询等待访问计数渲染（dev 首次编译较慢）
  for (let i = 0; i < 30; i++) {
    const has = await pg.evaluate(() => (document.querySelector("footer")?.innerText ?? "").includes("本站累计访问"));
    if (has) break;
    await wait(300);
  }
  await wait(800);
  const zh = await pg.evaluate(() => {
    const foot = document.querySelector("footer");
    const t = foot?.innerText ?? "";
    return {
      t,
      // 版权行加粗（font-semibold）
      boldCopyright: !!foot?.querySelector("p.font-semibold"),
      // 法律条款字号
      noticeClass: [...(foot?.querySelectorAll("p") ?? [])].map((p) => p.className),
    };
  });
  console.log("--- zh footer ---");
  console.log("  classes:", JSON.stringify(zh.noticeClass));
  assert(zh.t.includes("© 2026 艾比世界 (AIABW). All Rights Reserved."), "版权行（艾比世界 + AIABW）加粗保留");
  assert(zh.boldCopyright, "版权行为加粗（font-semibold）");
  assert(zh.t.includes("受著作权法保护") && zh.t.includes("不具备现实货币价值"), "法律免责条款存在");
  assert(zh.noticeClass.some((c) => c.includes("text-[11px]") && c.includes("leading-snug") && c.includes("text-slate-500")), "法律条款 text-[11px] + leading-snug + 浅灰");
  assert(zh.t.includes("v1.2.0"), "语义化版本号 v1.2.0（非 git hash）");
  assert(zh.t.includes("📊 本站累计访问 10,"), "访问计数显示 +10000 底数（10,xxx）");
  assert(!zh.t.includes("独立访客"), "已隐藏独立访客数据");
  assert(!/Abi World|Aibi World/.test(zh.t), "无 Abi World 品牌残留");

  // ---- en 页脚 ----
  await pg.goto(BASE + "/en", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);
  const en = await pg.evaluate(() => document.querySelector("footer")?.innerText ?? "");
  console.log("--- en footer ---");
  assert(en.includes("© 2026 AIABW. All Rights Reserved."), "英文版权行 AIABW");
  assert(en.includes("📊 Total visits: 10,"), "英文访问计数（+10000 底数）");
  assert(!en.includes("Unique Visitors"), "英文无独立访客");
  assert(!/Abi World|Aibi World/.test(en), "英文无 Abi World 残留");
  assert(en.includes("v1.2.0"), "英文版本号 v1.2.0");

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
