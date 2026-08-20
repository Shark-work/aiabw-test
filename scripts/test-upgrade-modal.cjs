// Browser test for the upgrade-payment modal flicker bug.
// 1) log in as an account with 1 pet (not unlocked), 2) click a pet card,
// 3) count /api/pay/create calls (must be exactly 1 after the fix),
// 4) sample the QR SVG repeatedly and verify the modal + QR stay stable (no flicker).
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
  let payCreateBodies = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/pay/create") && req.method() === "POST") {
      payCreateCalls += 1;
      payCreateBodies.push(req.postData());
    }
  });

  await page.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 点击第一张宠物卡片（需升级 → 弹窗）
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find((b) => b.innerText.includes("领养") || b.innerText.includes("解锁") || /提升|升级|多宠/.test(b.innerText));
    if (!target) return false;
    target.click();
    return true;
  });
  console.log("pet-card clicked=" + clicked);

  await new Promise((r) => setTimeout(r, 6000));

  // 连续采样弹窗与二维码（每 800ms × 6），检测是否闪烁
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const s = await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) => d.className.includes("z-50"));
      const qrSvg = modal ? modal.querySelector("svg") : null;
      const qrOuter = qrSvg ? qrSvg.outerHTML.slice(0, 400) : null;
      return {
        modalOpen: !!modal,
        loadingSpinner: !!modal?.innerText?.includes("生成"),
        qrPresent: !!qrSvg,
        qrFingerprint: qrOuter,
        modalTitle: modal?.innerText?.slice(0, 60) ?? null,
      };
    });
    samples.push(s);
    await new Promise((r) => setTimeout(r, 800));
  }

  const qrFingerprints = samples.filter((s) => s.qrFingerprint).map((s) => s.qrFingerprint);
  const modalTitles = samples.map((s) => s.modalTitle);
  const stableQr = qrFingerprints.length > 0 && new Set(qrFingerprints).size === 1;
  const stableModal = new Set(modalTitles).size === 1;
  const allOpen = samples.every((s) => s.modalOpen);
  const last = samples[samples.length - 1];

  console.log("crashed=" + crashed);
  console.log("pay/create calls=" + payCreateCalls + " (expect 1)");
  console.log("unique create bodies=" + new Set(payCreateBodies).size);
  console.log("qr samples=" + qrFingerprints.length + " stable=" + stableQr + " (expect stable=true)");
  console.log("modal always open=" + allOpen + " stable-title=" + stableModal + " (expect true)");
  console.log("final: modalOpen=" + last.modalOpen + " qrPresent=" + last.qrPresent + " loadingSpinner=" + last.loadingSpinner);

  const pass = payCreateCalls === 1 && stableQr && allOpen && stableModal && !crashed;
  console.log("RESULT: " + (pass ? "PASS ✅" : "FAIL ❌"));

  // 保存二维码内容（供验收：真实扫码用）
  const qrText = await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) => d.className.includes("z-50"));
    return modal?.innerText ?? "";
  }).catch(() => "");
  require("fs").writeFileSync(require("path").join(__dirname, "_upgrade-modal.txt"), qrText);
  console.log("modal text saved to scripts/_upgrade-modal.txt");

  await browser.close();
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
