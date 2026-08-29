// 野性山林主题验证：head 防闪烁脚本 / 点击切换 data-theme / 雨雾光伪元素 / 截图
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const BASE = process.argv[2] || "http://localhost:3000";

(async () => {
  if (!chromePath) { console.error("NO_CHROME"); process.exit(2); }
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2000 });
  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));

  // 1) head 内联防闪烁脚本
  const hasInline = await page.evaluate(() => document.head.innerHTML.includes("aiabw_theme"));
  console.log("head 内联脚本:", hasInline);

  // 2) 初始 cute
  const initial = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("初始主题:", initial);

  // 3) 点击切换按钮（🌙）
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent && (b.textContent.includes("🌙") || b.textContent.includes("🌧️")));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const wild = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    stored: localStorage.getItem("aiabw_theme"),
    bodyBg: getComputedStyle(document.body).backgroundImage.includes("wild-bg.webp"),
    rain: getComputedStyle(document.body, "::before").backgroundImage.includes("linear-gradient"),
    mist: getComputedStyle(document.body, "::after").backgroundImage.includes("radial-gradient"),
    glow: getComputedStyle(document.documentElement, "::after").boxShadow.includes("255, 215, 0"),
  }));
  console.log("wild 主题:", JSON.stringify(wild));
  await page.screenshot({ path: "theme-wild.png", fullPage: false });

  // 4) 刷新后持久化（FOUC 防护：data-theme 在 hydration 前已设置）
  await page.reload({ waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 1500));
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("刷新后主题（应仍为 wild）:", afterReload);

  await browser.close();
  const ok = hasInline && wild.theme === "wild" && wild.stored === "wild" && wild.bodyBg && wild.rain && wild.mist && wild.glow && afterReload === "wild";
  console.log(ok ? "RESULT: ALL PASS" : "RESULT: FAILED");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
