// 安全与运维验证：脚本工具 + 登录防暴力 + 后台管理员管理
// 生产环境（https）无法伪造 x-forwarded-for（Vercel 覆盖），锁定/限流段跳过（本地已覆盖）。
const { execSync } = require("child_process");
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
const login = (email, password, ip = "10.0.0.1") =>
  fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

(async () => {
  const ts = Date.now().toString().slice(-6);
  const isProd = BASE.startsWith("https");
  const email = `secadmin_${ts}@test.aiabw`;
  // 本地测试用动态 IP（避免限流计数跨运行残留）
  const ipN = 100 + (Number(ts) % 100);
  const IP1 = `10.0.0.${ipN}`;
  const IP2 = `10.0.0.${ipN + 1}`;
  const IP9 = `10.0.0.${ipN + 8}`;

  // ---- 1) add-admin 脚本：新增测试管理员并登录 ----
  const add = execSync(`node scripts/add-admin.cjs ${email} SecPass123`, { encoding: "utf8" }).trim();
  console.log("  add-admin:", add);
  assert(add.includes("已新增管理员"), "add-admin 新增管理员成功");
  let r = await login(email, "SecPass123", IP1);
  assert(r.status === 200 && r.json.ok, "新增管理员可用密码登录");

  // qapay（管理员）：供解锁与后台页面验证
  const qapay = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((x) => x.json());

  if (!isProd) {
    // ---- 2) 账户锁定：连续 5 次错密码 → 锁定 30 分钟 ----
    for (let i = 0; i < 5; i++) {
      r = await login(email, "WrongPass", IP2);
    }
    assert(r.status === 401, "连续错误第 5 次返回 401（触发锁定）");
    r = await login(email, "SecPass123", IP1);
    console.log("  locked attempt:", r.status, JSON.stringify(r.json).slice(0, 120));
    assert(r.status === 429 && /锁定/.test(r.json.error), "锁定后正确密码也被拒绝（429 锁定提示）");

    // ---- 3) 解锁 API（admin）：解锁后重新登录 ----
    const adminList = await fetch(BASE + "/api/admin/settings/admins", {
      headers: { Authorization: `Bearer ${qapay.token}` },
    }).then((x) => x.json());
    const target = adminList.admins.find((a) => a.email === email);
    assert(!!target && target.locked === true, "管理员列表中该账号显示已锁定");
    const unlock = await fetch(BASE + "/api/admin/users/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${qapay.token}` },
      body: JSON.stringify({ userId: target.id }),
    }).then((x) => x.json());
    assert(unlock.ok, "解锁 API 成功");
    r = await login(email, "SecPass123", IP1);
    assert(r.status === 200, "解锁后可用原密码登录");
  } else {
    console.log("  SKIP 生产环境无法伪造 IP：锁定/解锁/限流已在本地验证");
  }

  // ---- 4) change-admin-password 脚本：改密后用新密码登录 ----
  const chg = execSync(`node scripts/change-admin-password.cjs ${email} NewPass456`, { encoding: "utf8" }).trim();
  console.log("  change-password:", chg);
  assert(chg.includes("已更新"), "change-admin-password 修改成功");
  r = await login(email, "NewPass456");
  assert(r.status === 200, "新密码可登录");
  r = await login(email, "SecPass123", IP1);
  assert(r.status === 401, "旧密码不可登录");

  if (!isProd) {
    // ---- 5) IP 频率限制：同 IP 1 分钟 6 次 → 第 6 次 429 ----
    const fake = `fake_${ts}@test.aiabw`;
    let last = null;
    for (let i = 0; i < 6; i++) {
      last = await login(fake, "WrongPass", IP9);
    }
    console.log("  6th attempt:", last.status);
    assert(last.status === 429 && /60 秒/.test(last.json.error), "同 IP 第 6 次登录返回 429 频率限制");
  }

  // ---- 6) 后台管理员管理页面（浏览器）----
  const puppeteer = require("puppeteer-core");
  const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pg.evaluate((tk) => localStorage.setItem("aiabw_token", tk), qapay.token);
  await pg.goto(BASE + "/admin/settings/admins", { waitUntil: "domcontentloaded", timeout: 30000 });
  for (let i = 0; i < 30; i++) {
    const has = await pg.evaluate(() => document.body.innerText.includes("管理员管理"));
    if (has) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 800));
  const page = await pg.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasTitle: t.includes("管理员管理"),
      hasList: t.includes("注册时间") && t.includes("最后登录"),
      hasForm: t.includes("修改密码") && t.includes("新增管理员"),
    };
  });
  console.log("  admins page:", JSON.stringify(page));
  assert(page.hasTitle && page.hasList && page.hasForm, "后台管理员管理页面（列表+改密+新增）");
  await browser.close();

  // 清理测试管理员（保留审计记录，仅删账号）
  const fs = require("fs");
  const { Pool } = require("@neondatabase/serverless");
  const env = fs.readFileSync(".env", "utf8");
  const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
  const pool = new Pool({ connectionString: url, max: 2 });
  await pool.query(`DELETE FROM users WHERE email = $1`, [email]).catch(() => {});
  await pool.end();

  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
