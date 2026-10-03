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
