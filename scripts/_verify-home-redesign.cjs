// 首页重构效果验证（真实浏览器渲染）：检查板块顺序 + 截图
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

(async () => {
  if (!chromePath) {
    console.error("NO_CHROME");
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2400 });
  await page.goto("http://localhost:3000/zh", { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4500));

  const text = await page.evaluate(() => document.body.innerText);
  const order = ["动物世界头条", "盲盒广场", "刚刚诞生的伙伴", "热门宠物展示"];
  let prev = -1;
  let allOk = true;
  for (const s of order) {
    const idx = text.indexOf(s);
    const ok = idx > prev;
    if (!ok) allOk = false;
    console.log(`${ok ? "  OK  " : "  FAIL"} [${s}] @${idx}`);
    prev = idx;
  }
  // 桌面端侧栏检查（lg 显示）与移动端折叠（lg:hidden）
  const desktopSidebar = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    return aside ? getComputedStyle(aside).display : "none";
  });
  console.log("desktop sidebar display:", desktopSidebar);

  await page.screenshot({ path: "home-redesign-desktop.png", fullPage: true });

  // 移动端视口验证
  await page.setViewport({ width: 390, height: 2400 });
  await new Promise((r) => setTimeout(r, 1500));
  const mobileSidebar = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    return aside ? getComputedStyle(aside).display : "none";
  });
  await page.screenshot({ path: "home-redesign-mobile.png", fullPage: true });
  console.log("mobile sidebar display:", mobileSidebar);

  await browser.close();
  console.log(allOk ? "RESULT: ALL PASS" : "RESULT: FAILED");
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
