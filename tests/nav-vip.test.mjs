// 全局导航栏 VIP 入口单测
// 覆盖：i18n keys（zh/en）、SiteHeader 中 VIP 入口的两种状态分支、
//      /api/subscription/status 调用、移动端菜单图标分支。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd());

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

const headerPath = join(ROOT, "src/components/layout/SiteHeader.tsx");
const header = readFileSync(headerPath, "utf8");

test("i18n: zh.json has navUpgrade / navVipDays / vipBadgeShort", () => {
  const zh = readJson(join(ROOT, "messages/zh.json"));
  assert.equal(typeof zh.nav.navUpgrade, "string");
  assert.equal(typeof zh.nav.navVipDays, "string");
  assert.equal(typeof zh.nav.vipBadgeShort, "string");
  // 中文文案要点
  assert.match(zh.nav.navUpgrade, /VIP/);
  assert.match(zh.nav.navVipDays, /\{days\}/);
  assert.match(zh.nav.navVipDays, /天/);
});

test("i18n: en.json has navUpgrade / navVipDays / vipBadgeShort", () => {
  const en = readJson(join(ROOT, "messages/en.json"));
  assert.equal(typeof en.nav.navUpgrade, "string");
  assert.equal(typeof en.nav.navVipDays, "string");
  assert.equal(typeof en.nav.vipBadgeShort, "string");
  assert.match(en.nav.navUpgrade, /VIP/i);
  assert.match(en.nav.navVipDays, /\{days\}/);
});

test("i18n: navUpgrade/navVipDays are not empty placeholders", () => {
  for (const [lang, f] of [["zh", "zh.json"], ["en", "en.json"]]) {
    const j = readJson(join(ROOT, "messages", f));
    assert.ok(j.nav.navUpgrade.length > 1, `${lang} navUpgrade should be non-trivial`);
    assert.ok(j.nav.navVipDays.length > 1, `${lang} navVipDays should be non-trivial`);
  }
});

test("SiteHeader: imports useTranslations('nav')", () => {
  assert.match(header, /useTranslations\(\s*['"]nav['"]\s*\)/);
});

test("SiteHeader: fetches /api/subscription/status", () => {
  assert.match(header, /\/api\/subscription\/status/);
});

test("SiteHeader: subscribes to Authorization bearer from localStorage token", () => {
  // 与 /api/auth/me 复用同一个 aiabw_token，避免双请求双头
  const tokenSection = header.match(/aiabw_token[\s\S]{0,1500}?subscription\/status/);
  assert.ok(tokenSection, "should read aiabw_token before calling subscription/status");
  assert.match(tokenSection[0], /Authorization.*Bearer/);
});

test("SiteHeader: status effect depends on me (gate to avoid 401 flash)", () => {
  // ensureDbSchemaOnce / fetch subscription 块在 me 已加载后跑
  const section = header.match(/\[pathname,\s*me\]/);
  assert.ok(section, "useEffect deps should include me so it refetches after auth loads");
});

test("SiteHeader: hides VIP entry when me is null (unauthenticated)", () => {
  // {me && sub && (...)} gate 保证未登录不渲染
  const idx = header.indexOf("{me && sub");
  assert.ok(idx > 0, "expected conditional render gate {me && sub && ...}");
  // 桌面 + 移动两处都应使用同一 gate
  const occurrences = (header.match(/\{me && sub && \(/g) || []).length;
  assert.ok(occurrences >= 2, `expected 2+ {me && sub && ...} gates, got ${occurrences}`);
});

test("SiteHeader: renders gradient '升级 VIP' button for free users", () => {
  // 桌面端 ternary: sub.isVip ? <Link purple/> : <Link gradient/>
  // 用贪婪匹配确保覆盖整个 ternary
  const ternary = header.match(/sub\.isVip\s*\?[\s\S]{0,1800}?\)\s*\}/);
  assert.ok(ternary, "expected sub.isVip ternary with two Link branches");
  // free 分支: gradient + 文字
  assert.match(header, /bg-gradient-to-r from-amber-400 to-orange-500/);
  assert.match(header, /\{t\(\"navUpgrade\"\)\}/);
  // href="/subscribe"
  assert.match(header, /href=\"\/subscribe\"/);
  // ✨ icon (aria-hidden) in free branch
  assert.match(header, /aria-hidden>✨<\/span>/);
});

test("SiteHeader: renders purple '💎 Nd' badge for VIP users", () => {
  // 紫色背景 + navVipDays 含 daysRemaining
  assert.match(header, /bg-purple-100/);
  assert.match(header, /text-purple-700/);
  assert.match(header, /\{t\(\"navVipDays\"[\s\S]{0,40}?sub\.daysRemaining/);
});

test("SiteHeader: mobile menu has icon-only VIP entry", () => {
  // 在 grid-cols-2 之后插入 👑/💎 + 'VIP' 短文字
  // 整个 mobile nav block 较长：放大 0,3000 容差
  const mobile = header.match(/md:hidden[\s\S]{0,3000}?👑[\s\S]{0,400}?<\/Link>/);
  assert.ok(mobile, "expected mobile menu 👑 icon entry");
  // 移动端 VIP 块（💎 紫色 - VIP 已订阅）
  assert.match(header, /<span aria-hidden>💎<\/span>/);
  // VIP short text
  assert.match(header, />VIP</);
});

test("SiteHeader: VIP entry uses dark mode classes for purple variant", () => {
  assert.match(header, /dark:bg-purple-900\/30/);
  assert.match(header, /dark:text-purple-300/);
});

test("SiteHeader: not regressing on existing /api/auth/me + login/logout/register", () => {
  // 防止改动后破坏原有登录态逻辑
  assert.match(header, /fetch\("\/api\/auth\/me"/);
  assert.match(header, /t\("login"\)/);
  assert.match(header, /t\("register"\)/);
  assert.match(header, /t\("logout"\)/);
});
