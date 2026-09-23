// 探索页「已登录仍提示请先登录」权限检查异常的回归测试（2026-09 修复）。
//
// 事故根因：
//  本站登录态只保存在 localStorage 的 aiabw_token，API 一律 Authorization: Bearer
//  （见 README ③ 与 chat-auth-repair.test.mjs），登录流程从不写 cookie。
//  但 /explore-v2 的服务端页面却从 cookie 读取 aiabw_token → 永远为 null →
//  已登录用户（页头正常显示邮箱）也被渲染「请先登录」。
//  同类问题：ExploreButton 调 /api/exploration/start、ExploreV2Panel 调
//  /api/exploration/history 均未携带 Bearer → 即使页面放行，交互时也必然 401。
//
// 修复要点（本测试锁定的契约）：
//  1) page.tsx 不再用 cookie 做 SSR 鉴权，直接渲染客户端面板；
//  2) 面板挂载时读 localStorage，Bearer 拉取 /api/exploration/quota + /history；
//     仅无 token 或接口 401 时才显示登录引导（含回跳链接）；
//  3) ExploreButton 调 /start 携带 Bearer，401 时清 token 并回调 onAuthExpired；
//  4) 新增 GET /api/exploration/quota：Bearer 鉴权，返回 todayCount/maxCount/isVip。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── 1) 服务端页面不再做 cookie 鉴权 ─────────────
test("explore page: 服务端页面不做 cookie 鉴权，直接渲染客户端面板", () => {
  const ts = read("src/app/[locale]/explore-v2/page.tsx");
  assert.ok(ts.includes("ExploreV2Panel"), "renders ExploreV2Panel");
  assert.ok(!ts.includes("cookieStore"), "no cookie gating (token lives in localStorage)");
  assert.ok(!ts.includes("verifyToken"), "no server-side token verify");
  assert.ok(!ts.includes("signInFirst"), "no SSR sign-in gate");
});

// ───────────── 2) 面板：localStorage 驱动鉴权 + Bearer 拉取首屏 ─────────────
test("explore panel: localStorage token 驱动鉴权，quota/history 均带 Bearer", () => {
  const ts = read("src/components/exploration-v2/explore-v2-panel.tsx");
  assert.ok(ts.includes('localStorage.getItem("aiabw_token")'), "reads token from localStorage");
  assert.ok(/Authorization:\s*`Bearer \$\{token\}`/.test(ts), "builds Bearer header");
  assert.ok(ts.includes("/api/exploration/quota"), "fetches quota snapshot");
  assert.ok(ts.includes("/api/exploration/history"), "fetches history");
  assert.ok(ts.includes("qRes.status === 401"), "detects 401 from quota/history");
  assert.ok(ts.includes('localStorage.removeItem("aiabw_token")'), "clears stale token on 401");
});

test("explore panel: 仅游客态显示「请先登录」，并提供带回跳的登录链接", () => {
  const ts = read("src/components/exploration-v2/explore-v2-panel.tsx");
  assert.ok(ts.includes('authState === "guest"'), "guest-only gate");
  assert.ok(ts.includes('t("signInFirst")'), "guest view shows signInFirst");
  assert.ok(
    ts.includes("/login?redirect=/${locale}/explore-v2"),
    "login link carries redirect back to /explore-v2",
  );
});

// ───────────── 3) 探索按钮：/start 携带 Bearer + 401 回调 ─────────────
test("explore button: /api/exploration/start 携带 Bearer，401 时清 token 并回调", () => {
  const ts = read("src/components/exploration-v2/explore-button.tsx");
  assert.ok(ts.includes('localStorage.getItem("aiabw_token")'), "reads token from localStorage");
  assert.ok(/Authorization:\s*`Bearer \$\{token\}`/.test(ts), "sends Bearer header");
  assert.ok(ts.includes("onAuthExpired"), "accepts onAuthExpired prop");
  assert.ok(ts.includes('localStorage.removeItem("aiabw_token")'), "clears stale token on SIGN_IN_REQUIRED");
});

// ───────────── 4) 配额接口：Bearer 鉴权 + 配额快照字段 ─────────────
test("quota route: GET /api/exploration/quota Bearer 鉴权并返回配额快照", () => {
  const p = "src/app/api/exploration/quota/route.ts";
  assert.ok(existsSync(join(ROOT, p)), "quota route exists");
  const ts = read(p);
  assert.ok(ts.includes("getUserFromRequest"), "Bearer auth via getUserFromRequest");
  assert.ok(ts.includes('"SIGN_IN_REQUIRED"'), "401 SIGN_IN_REQUIRED when anonymous");
  assert.ok(ts.includes("getMaxExplorations"), "computes maxCount via engine");
  assert.ok(ts.includes("getActiveSubscription"), "VIP via active subscription");
  for (const k of ["todayCount", "maxCount", "isVip"]) {
    assert.ok(ts.includes(k), `returns ${k}`);
  }
});

// ───────────── 5) i18n：重试文案在 zh/en 均存在 ─────────────
test("i18n: explorationV2.loadFailedRetry 在 zh/en 均存在", () => {
  for (const loc of ["zh", "en"]) {
    const j = JSON.parse(read(`messages/${loc}.json`));
    assert.ok(
      typeof j.explorationV2.loadFailedRetry === "string" &&
        j.explorationV2.loadFailedRetry.length > 0,
      `${loc}.json missing explorationV2.loadFailedRetry`,
    );
  }
});
