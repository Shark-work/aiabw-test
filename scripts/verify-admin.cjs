// 站长后台 E2E：权限拦截（未登录/普通用户）+ admin 看板 + 宠物管理 API
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

  // ---- 1) 未登录访问 /admin/dashboard → 重定向登录页 ----
  await pg.goto(BASE + "/admin/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);
  const url1 = await pg.evaluate(() => location.pathname + location.search);
  console.log("  guest ->", url1);
  assert(/login/.test(url1), "未登录访问后台被重定向到登录页");

  // ---- 2) 普通用户访问 → 重定向登录 ----
  const ts = Date.now().toString().slice(-6);
  const email = `norm_${ts}@test.aiabw`;
  const reg = await fetch(BASE + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "normpass123" }),
  }).then((r) => r.json());
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pg.evaluate((tk) => localStorage.setItem("aiabw_token", tk), reg.token);
  await pg.goto(BASE + "/admin/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);
  const url2 = await pg.evaluate(() => location.pathname);
  console.log("  normal user ->", url2);
  assert(/login/.test(url2), "普通用户访问后台被重定向到登录页");

  // 普通用户调管理 API → 403
  const forbidden = await fetch(BASE + "/api/admin/stats", { headers: { Authorization: `Bearer ${reg.token}` } });
  assert(forbidden.status === 403, "普通用户调 /api/admin/stats 返回 403");

  // ---- 3) admin 登录 → 看板正常 ----
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  assert(!!login.token, "admin 登录成功");
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pg.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await pg.goto(BASE + "/admin/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(3000);
  const dash = await pg.evaluate(() => {
    const t = document.body.innerText;
    const aside = document.querySelector("aside");
    const menuLinks = aside ? aside.querySelectorAll("nav a").length : 0;
    return {
      hasSidebar: aside !== null && menuLinks === 6,
      hasStats: t.includes("总用户数") && t.includes("今日新增") && t.includes("累计访问量") && t.includes("今日合成次数"),
      statsValue: (t.match(/总用户数\s*([\d,]+)/) || [])[1] ?? null,
    };
  });
  console.log("--- dashboard ---", JSON.stringify(dash));
  assert(dash.hasSidebar, "左侧边栏完整（6 个菜单）");
  assert(dash.hasStats, "看板 4 项指标卡（总用户/今日新增/累计访问/今日合成）");
  assert(dash.statsValue !== null, "指标有数值（总用户数）");

  // ---- 4) admin 管理 API：宠物列表 + 看板统计 ----
  const stats = await fetch(BASE + "/api/admin/stats", { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
  console.log("  stats:", JSON.stringify(stats.stats));
  assert(stats.ok && typeof stats.stats.totalUsers === "number", "看板 API 返回统计");
  const pets = await fetch(BASE + "/api/admin/pets?page=1&pageSize=5", { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
  console.log("  admin pets:", pets.pets?.length, "total:", pets.total);
  assert(pets.ok && Array.isArray(pets.pets) && pets.pets.length > 0, "宠物列表 API 返回数据");
  assert(pets.pets.every((p) => typeof p.visible === "boolean"), "宠物含 visible（上架状态）");

  // 下架一只宠物 → catalog 对普通用户不可见 → 恢复
  const target = pets.pets[0];
  const off = await fetch(BASE + "/api/admin/pets/" + encodeURIComponent(target.id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ visible: false }),
  }).then((r) => r.json());
  assert(off.ok && off.pet.visible === false, "下架宠物成功");
  const cat = await fetch(BASE + "/api/pets/catalog?limit=200&species=" + encodeURIComponent(target.speciesId)).then((r) => r.json());
  const stillVisible = (cat.pets || []).some((p) => p.id === target.id);
  assert(!stillVisible, "下架宠物在普通用户图鉴中不可见");
  await fetch(BASE + "/api/admin/pets/" + encodeURIComponent(target.id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ visible: true }),
  });
  console.log("  restored pet:", target.id);

  console.log("\npageerror:", pageErr ? "出现（见上方）" : "无");
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 && !pageErr ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 && !pageErr ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
