// 动物世界头条模块 E2E：接口 + 首页轮播（自动切换/悬停暂停/热度标签/版权声明）
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
  // ---- 1) /api/news/hot ----
  const hot = await fetch(BASE + "/api/news/hot").then((r) => r.json());
  console.log("--- /api/news/hot ---");
  assert(hot.ok && Array.isArray(hot.news), "接口返回 ok + news 数组");
  assert(hot.news.length >= 1 && hot.news.length <= 5, "Top 1-5 条新闻");
  assert(hot.news.every((n) => n.title && n.source && typeof n.hot === "number"), "每条含 title/source/hot");
  // 热度降序
  const sorted = hot.news.every((n, i) => i === 0 || hot.news[i - 1].hot >= n.hot);
  assert(sorted, "按热度分降序排列");
  console.log("  top1:", hot.news[0]?.title.slice(0, 40), "| hot:", hot.news[0]?.hot);

  // ---- 2) 首页轮播 ----
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  let pageErr = null;
  pg.on("pageerror", (e) => {
    pageErr = String(e);
    console.log("  WARN pageerror:", String(e).slice(0, 140));
  });
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(3000);

  const newsBlock = await pg.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) => s.innerText.includes("动物世界头条"));
    if (!sec) return { found: false };
    const title = sec.querySelector("p.line-clamp-2")?.textContent ?? "";
    const hotTag = sec.innerText.match(/🔥 [0-9.]+w? 热度/)?.[0] ?? null;
    const copy = sec.innerText.includes("版权归原作者所有");
    const dots = sec.querySelectorAll("button[aria-label^='news']").length;
    return { found: true, title, hotTag, copy, dots };
  });
  console.log("--- home news block ---", JSON.stringify(newsBlock));
  assert(newsBlock.found, "首页显示「🐾 动物世界头条」模块");
  assert(newsBlock.title.length > 0, "展示新闻标题");
  assert(newsBlock.hotTag !== null, "热度标签（🔥 x 热度）");
  assert(newsBlock.copy, "版权声明小字存在");
  assert(newsBlock.dots === newsBlock.dots && newsBlock.dots >= 1, "轮播指示点");

  // ---- 3) 自动轮播：5s 后标题变化 ----
  const title1 = newsBlock.title;
  await wait(5600);
  const title2 = await pg.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) => s.innerText.includes("动物世界头条"));
    return sec?.querySelector("p.line-clamp-2")?.textContent ?? "";
  });
  console.log("  auto-switch:", title1.slice(0, 24), "→", title2.slice(0, 24));
  assert(title2.length > 0 && title2 !== title1, "5s 自动轮播切换新闻");

  // ---- 4) 悬停暂停：真实鼠标移入后 6s 标题不变 ----
  const cardBox = await pg.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) => s.innerText.includes("动物世界头条"));
    const card = sec?.querySelector(".overflow-hidden");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (cardBox) await pg.mouse.move(cardBox.x, cardBox.y);
  await wait(300);
  const pausedTitle = await pg.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) => s.innerText.includes("动物世界头条"));
    return sec?.querySelector("p.line-clamp-2")?.textContent ?? "";
  });
  await wait(6200);
  const pausedTitle2 = await pg.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) => s.innerText.includes("动物世界头条"));
    return sec?.querySelector("p.line-clamp-2")?.textContent ?? "";
  });
  console.log("  paused:", pausedTitle.slice(0, 24), "| after 6s:", pausedTitle2.slice(0, 24));
  assert(pausedTitle === pausedTitle2, "悬停时暂停轮播（6s 标题不变）");

  // ---- 5) 点击新标签打开 ----
  const linkTarget = await pg.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) => s.innerText.includes("动物世界头条"));
    const a = sec?.querySelector("a");
    return { target: a?.getAttribute("target"), href: a?.getAttribute("href") ?? "" };
  });
  console.log("  link:", JSON.stringify(linkTarget));
  assert(linkTarget.target === "_blank" && linkTarget.href.length > 0, "点击在新标签页打开原文链接");

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
