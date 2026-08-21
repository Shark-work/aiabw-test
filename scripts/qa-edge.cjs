// QA edge-case tests: guest access to my-pets / pets (mine), fresh empty-account my-pets, synthesize button guest redirect.
const puppeteer = require("puppeteer-core");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "https://www.aiabw.com";

async function pageErrors(browser, url) {
  const p = await browser.newPage();
  const errs = [];
  let crashed = false;
  p.on("pageerror", (e) => { crashed = true; errs.push("PAGEERR:" + String(e).slice(0, 100)); });
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 100)); });
  const status = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).then((r) => r.status()).catch((e) => "ERR:" + e.message);
  await new Promise((r) => setTimeout(r, 3500));
  const info = await p.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasContent: t.length > 120,
      emptyState: t.includes("还没有宠物") || t.includes("no companions") || t.includes("No companions") || t.includes("空"),
      signIn: t.includes("登录") || t.includes("Sign in"),
      crashText: t.includes("Application error") || t.includes("client-side exception"),
      mainLen: t.length,
    };
  }).catch((e) => ({ evalErr: e.message.slice(0, 80) }));
  await p.close();
  return { status, crashed, errs: errs.slice(0, 4), ...info };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });

  // 1) 未登录访问 /zh/my-pets
  const g1 = await pageErrors(browser, BASE + "/zh/my-pets");
  console.log("[guest my-pets]", JSON.stringify(g1));

  // 2) 未登录访问 /zh/pets?mine=1（mine 需要登录 → 应不白屏）
  const g2 = await pageErrors(browser, BASE + "/zh/pets?mine=1");
  console.log("[guest pets?mine=1]", JSON.stringify(g2));

  // 3) 未登录 /zh/pets 页面：合成按钮点击 → 跳登录
  const p3 = await browser.newPage();
  await p3.goto(BASE + "/zh/pets", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  const synth = await p3.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((x) => x.innerText.includes("合成"));
    if (btn) btn.click();
    return !!btn;
  });
  await new Promise((r) => setTimeout(r, 2500));
  const afterClick = await p3.evaluate(() => window.location.pathname + window.location.search);
  console.log("[guest synthesize click] btn=" + synth + " landed=" + afterClick);
  await p3.close();

  // 4) 新注册用户（空数据）访问 /zh/my-pets
  const ts = Date.now().toString().slice(-6);
  const email = "qa_empty_" + ts + "@test.aiabw";
  const reg = await fetch(BASE + "/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qapass2026" }),
  }).then((r) => r.json());
  if (reg?.token) {
    const p4 = await browser.newPage();
    await p4.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
    await p4.evaluate((tk) => localStorage.setItem("aiabw_token", tk), reg.token);
    await p4.goto(BASE + "/zh/my-pets", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    const e = await p4.evaluate(() => {
      const t = document.body.innerText;
      return { empty: t.includes("还没有宠物") || t.includes("No companions") || t.includes("no companions"), adoptCta: t.includes("去领养") || t.includes("Adopt"), crashed: t.includes("Application error") };
    });
    console.log("[fresh-account my-pets]", JSON.stringify(e));
    await p4.close();
  } else {
    console.log("[fresh-account my-pets] register failed");
  }

  await browser.close();
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
