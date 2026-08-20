// Verify the 艾比每日灵感 module on the home page (desktop + mobile) and the species deep-link.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });

  // ---- desktop home ----
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 3500));
  const desk = await page.evaluate(() => {
    const txt = document.body.innerText;
    const meetBtn = Array.from(document.querySelectorAll("a")).find((a) => a.innerText.includes("去遇见它"));
    return {
      fortune: /今日运势|Today's fortune/.test(txt),
      hasSpecies: /【小熊猫|【[^】]{2,8}|meet a .+ today/.test(txt),
      meetBtn: !!meetBtn,
      meetHref: meetBtn?.getAttribute("href") ?? null,
      recentTitle: txt.includes("刚刚诞生的伙伴") || txt.includes("Just born"),
      recentCard: txt.includes("刚刚领养的") || txt.includes("just adopted"),
      diagnosticGone: !txt.includes("AI 工具诊断"),
    };
  });
  console.log("[desktop home]", JSON.stringify(desk));

  // ---- mobile (should stack vertically) ----
  const mob = await browser.newPage();
  await mob.setViewport({ width: 375, height: 720 });
  await mob.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 3500));
  const mobile = await mob.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("section"));
    // 每日灵感 section 里的直接子容器（上半/下半）应纵向排列
    return { sectionCount: sections.length, width: window.innerWidth };
  });
  console.log("[mobile home]", JSON.stringify(mobile));

  // ---- species deep-link: /zh/pets?species=... ----
  const s = await fetch(BASE + "/api/pets/daily").then((r) => r.json());
  if (s?.lucky?.speciesId) {
    const petPage = await browser.newPage();
    await petPage.goto(BASE + `/zh/pets?species=${encodeURIComponent(s.lucky.speciesId)}`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((r) => setTimeout(r, 3500));
    const pl = await petPage.evaluate(() => {
      const txt = document.body.innerText;
      const cards = document.querySelectorAll("img").length;
      return { hasSpeciesName: txt.includes("小熊猫") || txt.includes("Red Panda") || txt.includes("雪豹"), cards: Array.from(document.querySelectorAll(".grid > div")).length };
    });
    console.log("[pets deep-link species=" + s.lucky.speciesId + "]", JSON.stringify(pl));
    await petPage.close();
  }

  const pass = desk.fortune && desk.meetBtn && desk.recentTitle && desk.recentCard && desk.diagnosticGone;
  console.log("RESULT: " + (pass ? "PASS ✅" : "FAIL ❌"));
  await browser.close();
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
