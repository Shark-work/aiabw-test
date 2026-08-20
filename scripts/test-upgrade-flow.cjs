// Verify: after a 402 (pet-limit) opens the upgrade modal, pet cards must NOT stay disabled,
// and the modal + QR must render stably.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";

(async () => {
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  if (!login?.token) { console.log("LOGIN FAILED: " + JSON.stringify(login).slice(0, 200)); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let crashed = false;
  page.on("pageerror", () => { crashed = true; });

  let payCreateCalls = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/pay/create") && req.method() === "POST") payCreateCalls += 1;
  });

  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 1) 点第一张宠物卡片 → 弹窗
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find((b) => b.innerText.includes("领养") || b.innerText.includes("解锁") || /提升|升级|多宠/.test(b.innerText));
    if (!target) return false;
    target.click();
    return true;
  });
  console.log("pet-card clicked=" + clicked);
  await new Promise((r) => setTimeout(r, 4000));

  const afterOpen = await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) => d.className.includes("z-50"));
    const cards = Array.from(document.querySelectorAll("button")).filter((b) => b.innerText.includes("领养") || b.innerText.includes("解锁"));
    return {
      modalOpen: !!modal,
      qrPresent: !!modal?.querySelector("svg"),
      cardsDisabled: cards.filter((b) => b.disabled).length,
      cardsTotal: cards.length,
    };
  });
  console.log("after open: modal=" + afterOpen.modalOpen + " qr=" + afterOpen.qrPresent + " cardsDisabled=" + afterOpen.cardsDisabled + "/" + afterOpen.cardsTotal);

  // 2) 关闭弹窗（点“暂不”按钮）
  const closed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const notNow = btns.find((b) => b.innerText.includes("暂不") || b.innerText.includes("Not now"));
    if (!notNow) return false;
    notNow.click();
    return true;
  });
  console.log("modal closed=" + closed);
  await new Promise((r) => setTimeout(r, 1200));

  // 3) 弹窗已关 + 卡片不再 disabled（修复点：402 后恢复可点）
  const afterClose = await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) => d.className.includes("z-50"));
    const cards = Array.from(document.querySelectorAll("button")).filter((b) => b.innerText.includes("领养") || b.innerText.includes("解锁"));
    return {
      modalGone: !modal,
      cardsDisabled: cards.filter((b) => b.disabled).length,
      cardsTotal: cards.length,
    };
  });
  console.log("after close: modalGone=" + afterClose.modalGone + " cardsDisabled=" + afterClose.cardsDisabled + "/" + afterClose.cardsTotal);

  console.log("crashed=" + crashed + " pay/create calls=" + payCreateCalls);

  const pass = afterOpen.modalOpen && afterOpen.qrPresent && afterClose.modalGone &&
    afterClose.cardsDisabled === 0 && payCreateCalls === 1 && !crashed;
  console.log("RESULT: " + (pass ? "PASS ✅ (modal works, cards re-enabled after 402, single order)" : "FAIL ❌"));
  await browser.close();
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
