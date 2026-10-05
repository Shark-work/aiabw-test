// 2026-10-06 审计修复批次契约测试（逐项随对应 commit 追加断言组）：
//  A) / 与 /zh 路径内容一致性 —— 单一代码路径锁定（middleware 重定向 + 单一 [locale] 源码）；
//  D) /en 首页更新完整性 —— home 五 key + 导航 en 值锁定；
//  H) /en 运势语法 —— fortune 不含 "a {sign} day" 锁定；
//  B) 旧 Hero 文案残留、C) Just Born 去重、F) soul-cards 旧文案、G) 页脚版权 —— 随各自 commit 追加。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/locale-routes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// ---- A) / 与 /zh 路径内容一致性 ----
// 结论（2026-10-06 核实）：localePrefix:"always" 下 / 由 middleware 307 → /zh（或按
// Accept-Language/NEXT_LOCALE → /en），全站页面只有 src/app/[locale] 一份源码；
// 构建产物 .next/server/app/{zh,en} 为 SSG 静态份、[locale] 为动态回退，属同一代码的
// 正常产物而非双代码路径。内容差异只可能来自 CDN/构建缓存，Vercel 部署即整体替换。
test("A: localePrefix=always —— / 不重写、307 到 /{locale}，无双路径分叉", () => {
  const routing = read("src/i18n/routing.ts");
  assert.ok(routing.includes('locales: ["zh", "en"]'), "双语 locales");
  assert.ok(routing.includes('defaultLocale: "zh"'), "默认中文");
  assert.ok(routing.includes('localePrefix: "always"'), "始终带前缀（/ → 重定向而非 rewrite）");
});

test("A: middleware 统一走 next-intl createMiddleware，且排除 api/_next/静态资源", () => {
  const mw = read("src/middleware.ts");
  assert.ok(mw.includes("createMiddleware(routing)"), "单一 intl 中间件");
  assert.ok(mw.includes("intlMiddleware("), "所有匹配路径经同一处理器");
  assert.ok(mw.includes("(?!api|_next|_vercel|admin"), "matcher 排除 api/_next/admin");
});

test("A: 页面源码唯一 —— src/app 根下不存在与 [locale] 并行的首页/页面", () => {
  assert.ok(!existsSync(join(ROOT, "src/app/page.tsx")), "无 src/app/page.tsx 裸首页");
  assert.ok(!existsSync(join(ROOT, "src/app/layout.tsx.bak")), "无布局残留副本");
  assert.ok(existsSync(join(ROOT, "src/app/[locale]/page.tsx")), "唯一首页源码 [locale]/page.tsx");
});

test("A: vercel.json 不自定义页面缓存头（部署即整体失效 CDN，无需手动刷新）", () => {
  const vercel = JSON.parse(read("vercel.json"));
  assert.ok(!vercel.headers, "无 headers 覆盖（默认缓存策略，部署自动失效）");
});

// ---- B) 旧 Hero 文案残留（2026-10-06）----
// 首页 page.tsx 全走 i18n key（无硬编码旧 Hero）；唯一残留是 aibi.spotlight.subtitle
// 重复了首页「养育你的 AI 生命体 / 铸造艾比凭证」叙事 —— 已改为区块自述文案。
test("B: 旧 Hero 文案（养育你的 AI 生命体 / Raise your AI being）全站无残留", () => {
  assert.ok(!zh.aibi.spotlight.subtitle.includes("养育你的 AI 生命体"), "zh 旧 Hero 残留已清");
  assert.ok(!en.aibi.spotlight.subtitle.includes("Raise your AI being"), "en 旧 Hero 残留已清");
  assert.equal(zh.aibi.spotlight.subtitle, "实时供应 · 最新诞生 · 稀有橱窗", "zh 新区块自述");
  assert.equal(en.aibi.spotlight.subtitle, "Live supply · newest arrivals · rare showcase", "en 新区块自述");
  const home = read("src/app/[locale]/page.tsx");
  assert.ok(!home.includes("养育你的 AI 生命体"), "首页源码无硬编码旧 Hero");
  assert.ok(!home.includes("铸造艾比凭证"), "首页源码无硬编码旧 Hero(en/zh)");
});

// ---- C) Just Born（刚刚诞生的伙伴）重复数据（2026-10-06）----
// 双语共用同一 RecentBornMarquee（i18n 驱动），前端按 id 防御去重；双语一并覆盖。
test("C: RecentBornMarquee 渲染前按 id 去重（双语共用组件）", () => {
  const comp = read("src/components/daily-inspiration.tsx");
  assert.ok(
    comp.includes("Array.from(new Map(list.map((item) => [item.id, item])).values())"),
    "setRecent 前 new Map 按 id 去重",
  );
  // API 层：recent 查询以 pets.id 主键 SELECT，JOIN 均 1:1，不产生重复行
  const api = read("src/app/api/pets/daily/route.ts");
  assert.ok(api.includes("FROM pets p"), "recent 源表 pets（id 主键唯一）");
  assert.ok(api.includes("LIMIT 6"), "recent 上限 6 条");
});

// ---- D) /en 路径同步更新（2026-10-06 核实：五 key + 导航 en 值均已存在且正确）----
test("D: en home 五 key 与导航 en 值完整正确", () => {
  assert.equal(en.home.title, "Adopt Your AI Companion · Collect · Chat · Grow");
  assert.equal(
    en.home.subtitle,
    "Raise a unique AI pet, explore together, and collect scarce digital Soul Cards.",
  );
  assert.equal(en.home.heroCta, "Adopt Now");
  assert.equal(en.home.socialProof, "Join {count}+ collectors raising their AI companions");
  assert.equal(en.home.socialProofFallback, "Join thousands of collectors");
  // 2026-10-09 灵宠体系升级：「领养/我的宠物」→「我的灵宠 / My Soul Pets」
  // （不采用「灵魂卡/我的收藏」命名——与既有 navSoulCodex「灵魂卡/收藏」撞名，见 tests/soul-pet.test.mjs #7 撞名锁）
  assert.equal(en.nav.navAdoptMy, "🐾 My Soul Pets");
  assert.equal(en.nav.navSoulCodex, "✨ Collection");
  // zh 侧镜像（双语同源同步）
  assert.equal(zh.home.heroCta, "立即领养");
  assert.equal(zh.nav.navAdoptMy, "🐾 我的灵宠");
  assert.equal(zh.nav.navSoulCodex, "✨ 收藏");
});

// ---- H) /en 运势语法（2026-10-06 核实：已是 "{sign} day"，无 "a {sign} day"）----
test("H: en 运势文案不含 \"a {sign} day\" 语法错误", () => {
  assert.ok(en.home.fortune.includes("{sign} day"), "en fortune 含 {sign} day");
  assert.ok(!en.home.fortune.includes("a {sign} day"), "无多余冠词 a");
});

// ---- F) soul-cards 旧内容清理（2026-10-06）----
// soul Tab 标题「艾比图鉴 / Aibi Gallery」与 /codex 页（aibi.codex.title「艾比图鉴 /
// Aibi Codex」）撞名 → 改术语标准词「灵魂卡 / Soul Cards」；
// 页面 SEO（三 Tab 收藏中心上线后仍写「灵魂图鉴 / Soul Collection」）→ 更新为收藏中心。
test("F: soul-cards 不再有「图鉴」旧文案（Tab 标题 + SEO 均为收藏中心/灵魂卡）", () => {
  assert.equal(zh.aibi.soul.title, "灵魂卡", "zh soul Tab 标题");
  assert.equal(en.aibi.soul.title, "Soul Cards", "en soul Tab 标题");
  assert.notEqual(zh.aibi.soul.title, zh.aibi.codex.title, "soul Tab 与 /codex 页不撞名");
  assert.ok(zh.seo.soulCardsTitle.includes("收藏中心"), "zh SEO 标题 = 收藏中心");
  assert.ok(!zh.seo.soulCardsTitle.includes("图鉴"), "zh SEO 标题不再含图鉴");
  assert.ok(en.seo.soulCardsTitle.includes("Collection Center"), "en SEO 标题 = Collection Center");
  assert.ok(zh.seo.soulCardsDesc.includes("收藏中心"), "zh SEO 描述同步");
});

// ---- G) 页脚重复版权（2026-10-06）----
// 渲染层：copyrightLine 全站仅 FooterCollapsible 渲染一次（originalNotice 为原创声明长文，
// 非版权行，保留）；死键 footer.copyright（aiabw.com | v{version}）零消费方 → 已删除。
test("G: 页脚版权行单一渲染 + 无版权死键", () => {
  const footer = read("src/components/layout/Footer.tsx");
  assert.equal(footer.split('t("copyrightLine")').length - 1, 1, "Footer 仅取一次 copyrightLine");
  assert.ok(!footer.includes('t("copyright")'), "Footer 不消费死键 copyright");
  const coll = read("src/components/layout/FooterCollapsible.tsx");
  assert.equal(coll.split("{copyrightLine}").length - 1, 1, "FooterCollapsible 仅渲染一次版权行");
  assert.ok(!("copyright" in zh.footer), "zh footer.copyright 死键已删");
  assert.ok(!("copyright" in en.footer), "en footer.copyright 死键已删");
  assert.equal(zh.footer.copyrightLine, "© 2025-2026 艾比世界 (AIABW). All Rights Reserved.", "zh 唯一版权行保留");
  assert.equal(en.footer.copyrightLine, "© 2025-2026 AIABW. All Rights Reserved.", "en 唯一版权行保留");
});
