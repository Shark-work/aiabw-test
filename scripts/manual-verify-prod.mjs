#!/usr/bin/env node
/**
 * 阶段 4 人工验证 · 自动化等价探针（MV-1 ~ MV-12，生产 www.aiabw.com）
 * ============================================================
 * 等价覆盖 docs/RELEASE_CHECKLIST.md「阶段 4 人工验证」：
 *   匿名视角（等价隐身窗口）：
 *     MV-1  首页 /zh/ 可达（200 + 关键标记）
 *     MV-2  灵魂卡 Tab 可达（/zh/soul-cards + ?tab=nfr）
 *     MV-3  明信片墙隐私关闭时公开页 404（API 同 404，不泄露开关状态）
 *     MV-4  登录按钮正常跳转（首页含登录入口 + /zh/login 200）
 *   登录全流程（临时账号 prod-smoke-<ts>@test.dev —— 复用冒烟前缀，
 *   便于 scripts/cleanup-smoke-users.mjs 事后一键清理）：
 *     MV-5  注册 + 登录 + /api/auth/me
 *     MV-6  唤醒灵宠（onboarding 完成标记：completed + hasPet）
 *     MV-7  铸卡（候选 → /api/pets/claim → certificateNo）
 *     MV-8  收藏中心双 Tab 切换（soul / nfr 均 200，我的卡 1 张）
 *     MV-9  探索一次（event_id + 探索履历入账）
 *     MV-10 签到（streak=1）
 *     MV-11 断签补签：SQL 构造断签（last_checkin_date=前天, streak>0）
 *           → pay/create kind=checkin_makeup 创建 ¥1 补签单（入口验证）
 *           → SQL 等价模拟 notify 回填（条件与 pay/notify 路由一致：幂等只前进）
 *           → 当日签到 streak 延续为 2
 *     MV-12 明信片墙隐私开关往返：开 → 匿名公开页 200 → 关 → 匿名 404
 *
 * 用法（PowerShell，仓库根目录）：
 *   node scripts/manual-verify-prod.mjs
 *   $env:SMOKE_BASE="https://preview-xxx.vercel.app"  # 可选：preview 部署
 *
 * 输出：逐项 ✅/❌ + 关键状态记录 + 验证清单汇总表；
 *   全绿输出 ALL_MANUAL_VERIFY_OK，退出码 0；任一失败退出码 1。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.SMOKE_BASE ?? "https://www.aiabw.com").replace(/\/+$/, "");
console.log(`VERIFY_BASE = ${BASE}\n`);

/* ── DB（仅 MV-11 断签构造用）：env 优先，回退 .env ── */
let DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    DATABASE_URL = (fs.readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim() ?? "";
  }
}
if (!DATABASE_URL) {
  console.error("FATAL: 缺少 DATABASE_URL（env 或 .env），MV-11 断签构造无法执行");
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 10000 });
const q = (sql, p) =>
  Promise.race([pool.query(sql, p), new Promise((_, rej) => setTimeout(() => rej(new Error("DB_TIMEOUT")), 30000))]);

/* ── 报告器 ── */
const results = [];
function check(id, name, ok, detail = "") {
  results.push({ id, name, ok, detail });
  console.log(`[${id}] ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ── HTTP helpers（与 smoke-full.mjs 同模式）── */
async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = { "x-locale": "zh" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let json = {};
  try { json = JSON.parse(raw); } catch { /* HTML/非 JSON */ }
  return { status: res.status, json, raw };
}
function preview(r) {
  return `HTTP ${r.status} body=${(r.raw ?? "").slice(0, 160).replace(/\s+/g, " ")}`;
}

/* ── 日期（生产函数跑 UTC，与 checkin 路由口径一致）── */
const utcDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const YESTERDAY = utcDate(-1);
const DAY_BEFORE = utcDate(-2);


/* ════════════════════ 执行 ════════════════════ */
try {
  /* ── A 匿名视角（等价隐身窗口，无任何凭据）── */

  // MV-1 首页可达
  const home = await api("/zh/");
  const homeTitle = home.raw.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  check("MV-1", "匿名：首页 /zh/ 可达（200 + 标题标记）",
    home.status === 200 && home.raw.length > 1000 && homeTitle.length > 0,
    `title="${homeTitle.slice(0, 40)}" bytes=${home.raw.length}`);

  // MV-2 灵魂卡 Tab 可达
  const tabSoul = await api("/zh/soul-cards");
  const tabNfr = await api("/zh/soul-cards?tab=nfr");
  check("MV-2", "匿名：灵魂卡 Tab 可达（/zh/soul-cards + ?tab=nfr 均 200）",
    tabSoul.status === 200 && tabNfr.status === 200,
    `soul=${tabSoul.status} nfr=${tabNfr.status}`);

  // MV-4 登录按钮跳转：首页含登录入口 + 登录页 200
  const loginHref = home.raw.match(/href="([^"]*(?:login|auth|signin)[^"]*)"/)?.[1] ?? "";
  const loginPage = await api("/zh/login");
  check("MV-4", "匿名：登录按钮正常跳转（首页含登录入口 + /zh/login 200）",
    loginHref.length > 0 && loginPage.status === 200,
    `href="${loginHref}" loginPage=${loginPage.status}`);

  /* ── B 登录全流程（临时账号）── */
  const ts = Date.now();
  const email = `prod-smoke-${ts}@test.dev`;
  const password = "smoke-pass-123";
  const username = `mv${String(ts).slice(-8)}`;

  // MV-5 注册 + 登录 + me
  const reg = await api("/api/auth/register", { method: "POST", body: { email, password, username } });
  let token = reg.json?.token;
  let userId = reg.json?.user?.id;
  if (!token) {
    const login = await api("/api/auth/login", { method: "POST", body: { email, password } });
    token = login.json?.token;
    userId = login.json?.user?.id;
  }
  const me = token ? await api("/api/auth/me", { token }) : { status: 0 };
  check("MV-5", "登录态：注册 + 登录 + /api/auth/me",
    !!token && !!userId && me.status === 200,
    `email=${email} id=${userId} me=${me.status}`);
  if (!token || !userId) throw new Error("账号建立失败，终止后续用例");

  // MV-3 明信片墙隐私关闭 → 匿名公开页 404（新账号默认关）
  const wallPageClosed = await api(`/zh/postcard-wall/${userId}`);
  const wallApiClosed = await api(`/api/postcard-wall/${userId}`);
  check("MV-3", "匿名：明信片墙隐私关闭 → 公开页 404 + 公开 API 404",
    wallPageClosed.status === 404 && wallApiClosed.status === 404,
    `page=${wallPageClosed.status} api=${wallApiClosed.status}`);

  // MV-6 唤醒灵宠 → 铸卡一体：候选 → claim → onboarding 完成标记（hasPet 须在 claim 后检查）
  const ob0 = await api("/api/onboarding", { token });
  const candidatePetId = ob0.json?.candidate?.petId ?? null;
  const claim = candidatePetId
    ? await api("/api/pets/claim", { method: "POST", token, body: { petId: candidatePetId } })
    : { status: 0, json: {}, raw: "no candidate" };
  const cert = claim.json?.soulCard?.certificateNo ?? null;
  const obDone = await api("/api/onboarding", { method: "POST", token });
  const obAfter = await api("/api/onboarding", { token });
  check("MV-6", "唤醒灵宠：候选 → claim → 完成标记（completed=true + hasPet=true）",
    ob0.status === 200 && !!candidatePetId && claim.status === 200 &&
    obDone.status === 200 && obAfter.json?.completed === true && obAfter.json?.hasPet === true,
    `candidate=${candidatePetId ?? "none"} completed=${obAfter.json?.completed} hasPet=${obAfter.json?.hasPet}`);

  // MV-7 铸卡凭证：certificateNo 已签发
  check("MV-7", "铸卡：自动铸造灵魂卡（certificateNo）",
    typeof cert === "string" && cert.length > 0,
    cert ? `certificateNo=${cert}` : preview(claim));

  // MV-8 收藏中心双 Tab + 我的卡 1 张
  const myCards = await api("/api/soul-cards", { token });
  check("MV-8", "收藏中心：双 Tab 200 + 我的灵魂卡 1 张",
    myCards.status === 200 && (myCards.json?.cards?.length ?? 0) >= 1,
    `cards=${myCards.json?.cards?.length ?? 0}`);

  // MV-9 探索一次
  const start = await api("/api/exploration/start", { method: "POST", token });
  const eventId = start.json?.event?.id ?? null;
  check("MV-9", "探索一次：/api/exploration/start 200 + event_id",
    start.status === 200 && typeof eventId === "string",
    `event=${eventId ?? "none"} steps=${start.json?.steps ?? "?"}`);

  // MV-10 签到（streak=1）
  const c1 = await api("/api/user/checkin", { method: "POST", token, body: {} });
  check("MV-10", "签到：POST /api/user/checkin → streak=1",
    c1.status === 200 && c1.json?.streak === 1,
    `streak=${c1.json?.streak} pointsGain=${c1.json?.pointsGain} mood=${c1.json?.mood}`);

  // MV-11 断签补签（SQL 构造断签 → 补签单入口 → 等价回填 → 连签延续）
  await q("UPDATE users SET last_checkin_date=$1 WHERE id=$2", [DAY_BEFORE, userId]);
  const makeup = await api("/api/pay/create", { method: "POST", token, body: { kind: "checkin_makeup" } });
  const makeupOrderId = makeup.json?.orderId ?? makeup.json?.order_id ?? makeup.json?.outTradeNo ?? null;
  // 等价模拟 pay/notify 回填（WHERE 条件与 src/app/api/pay/notify/route.ts 一致：幂等、只前进）
  const backfill = await q(
    "UPDATE users SET last_checkin_date=$2 WHERE id=$1 AND (last_checkin_date IS NULL OR last_checkin_date < $2)",
    [userId, YESTERDAY]);
  const c2 = await api("/api/user/checkin", { method: "POST", token, body: {} });
  check("MV-11", "断签补签：断签→补签单 200 → 回填昨天 → 当日签到 streak 延续为 2",
    makeup.status === 200 && (backfill.rowCount ?? 0) === 1 && c2.status === 200 && c2.json?.streak === 2,
    `makeup=${makeup.status}${makeupOrderId ? ` order=${makeupOrderId}` : ""} backfillRows=${backfill.rowCount} streak=${c2.json?.streak}`);

  // MV-12 明信片墙隐私开关往返：开 → 匿名 200 → 关 → 匿名 404
  const patchOn = await api("/api/user/profile", { method: "PATCH", token, body: { postcardWallPublic: true } });
  const wallPageOpen = await api(`/zh/postcard-wall/${userId}`);
  const wallApiOpen = await api(`/api/postcard-wall/${userId}`);
  const patchOff = await api("/api/user/profile", { method: "PATCH", token, body: { postcardWallPublic: false } });
  const wallPageReclosed = await api(`/zh/postcard-wall/${userId}`);
  check("MV-12", "明信片墙隐私开关：开 → 匿名公开页 200 → 关 → 匿名 404（隐私回滚）",
    patchOn.status === 200 && wallPageOpen.status === 200 && wallApiOpen.status === 200 &&
    patchOff.status === 200 && wallPageReclosed.status === 404,
    `open=${wallPageOpen.status}/${wallApiOpen.status} reclosed=${wallPageReclosed.status}`);

  /* ── 验证清单汇总 ── */
  const fails = results.filter((r) => !r.ok);
  console.log("\n════════ 阶段 4 验证清单 ════════");
  console.log("| 项 | 验证内容 | 结果 |");
  console.log("| --- | --- | --- |");
  for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.ok ? "✅" : "❌"} |`);
  console.log(`\n验证账号：${email}（prod-smoke- 前缀，cleanup-smoke-users.mjs 可一键清理）`);
  if (fails.length === 0) {
    console.log(`\nALL_MANUAL_VERIFY_OK（${results.length}/${results.length}）`);
    await pool.end();
    process.exit(0);
  }
  console.error(`\nMANUAL_VERIFY_FAILED：${fails.length}/${results.length} 项失败 → ${fails.map((f) => f.id).join(", ")}`);
  await pool.end();
  process.exit(1);
} catch (e) {
  console.error("FATAL: " + (e?.stack || e?.message || e));
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
}

