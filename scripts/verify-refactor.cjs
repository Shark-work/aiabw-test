// Verify nav/route refactor: /pets is pure encyclopedia (no synthesize), /pets/my has synthesize + own pets,
// /points has redeem card, nav label "动物图鉴", guest /pets/my redirects to login.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const fails = [];

  // 1) guest /zh/pets: pure encyclopedia, NO synthesize button
  const p1 = await browser.newPage();
  await p1.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 8000));
  const catalog = await p1.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim());
    return {
      hasSynthesize: btns.some((x) => x.includes("合成")),
      hasFilters: btns.some((x) => ["全部", "All"].includes(x)),
      hasDesc: document.body.innerText.includes("介绍") || document.body.innerText.includes("这只") || document.body.innerText.includes("default") || document.querySelectorAll(".grid > div").length > 0,
      cardCount: document.querySelectorAll(".grid > div").length,
      navLabel: Array.from(document.querySelectorAll("header a")).map((a) => a.innerText.trim()).includes("动物图鉴"),
    };
  });
  console.log("[catalog]", JSON.stringify(catalog));
  if (catalog.hasSynthesize) fails.push("/pets still has synthesize button");
  if (!catalog.navLabel) fails.push("nav label not updated");
  if (catalog.cardCount < 1) fails.push("catalog empty");
  await p1.close();

  // 2) guest /zh/pets/my -> redirect to login
  const p2 = await browser.newPage();
  await p2.goto(BASE + "/zh/pets/my", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 3000));
  const guestMy = await p2.evaluate(() => window.location.pathname);
  console.log("[guest /pets/my] landed=" + guestMy);
  if (!guestMy.includes("/login")) fails.push("/pets/my guest did not redirect to login");
  await p2.close();

  // 3) login qapay -> /zh/pets/my: synthesize button + own pets only
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  const p3 = await browser.newPage();
  await p3.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await p3.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await p3.goto(BASE + "/zh/pets/my", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 5000));
  const my = await p3.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim());
    return {
      hasSynthesize: btns.some((x) => x.includes("合成")),
      hasBack: btns.some((x) => x.includes("返回图鉴")) || document.body.innerText.includes("返回图鉴"),
      hasOwnMark: document.body.innerText.includes("由你于") || document.body.innerText.includes("孕育") || document.body.innerText.includes("Born for you"),
      cardCount: document.querySelectorAll(".grid > div").length,
    };
  });
  console.log("[/pets/my]", JSON.stringify(my));
  if (!my.hasSynthesize) fails.push("/pets/my missing synthesize button");
  if (!my.hasOwnMark) fails.push("/pets/my missing own-pet marks");
  await p3.close();

  // 4) /zh/points redeem card
  const p4 = await browser.newPage();
  await p4.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 25000 });
  await p4.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await p4.goto(BASE + "/zh/points", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise((r) => setTimeout(r, 4000));
  const redeem = await p4.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasCard: t.includes("积分兑换") || t.includes("Points Redemption"),
      hasPrice: t.includes("500"),
      hasProgress: t.includes("再获得") || t.includes("more points"),
      hasBtn: Array.from(document.querySelectorAll("button")).some((b) => b.innerText.includes("兑换新伙伴") || b.innerText.includes("Redeem companion")),
    };
  });
  console.log("[/points redeem card]", JSON.stringify(redeem));
  if (!redeem.hasCard || !redeem.hasBtn) fails.push("/points redeem card missing");
  await p4.close();

  console.log("FAILURES: " + (fails.length ? fails.join(" | ") : "none ✅"));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
