/**
 * 契约测试 · 后台保存自动失效缓存（任务六 revalidate hooks）
 *
 *  A) revalidate.ts：动态 import next/cache（CLI/迁移脚本 Node 直跑安全红线——
 *     顶层 import 会让 --disable-transpile 原生 ESM 加载 payload.config 时崩溃）、
 *     catch 静默（非请求上下文无增量缓存可失效）；
 *  B) 7 业务 Collection + 3 Global 全部注册 afterChange hook，tag 命名对齐任务六规范
 *     （species/pet-animations/stories/pages/banners/products/token-rules/
 *     site-settings/home-hero/points-economy）；
 *  C) hooks tag 与 loaders.ts withFallback 失效 tag 一一对应（否则保存后不失效）；
 *  D) 本测试已挂载 npm test。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const COLLECTION_TAGS = {
  Species: "species",
  PetAnimations: "pet-animations",
  Stories: "stories",
  Pages: "pages",
  Banners: "banners",
  Products: "products",
  TokenRules: "token-rules",
};
const GLOBAL_TAGS = {
  SiteSettings: "site-settings",
  HomeHero: "home-hero",
  PointsEconomy: "points-economy",
};

// ─────────────────────── A) revalidate.ts 红线 ───────────────────────
test("payload-hooks(A): 动态 import next/cache + 非请求上下文静默（CLI 安全）", () => {
  const r = read("src/collections/revalidate.ts");
  assert.ok(r.includes('void import("next/cache")'), "动态 import（顶层零 Next 依赖）");
  assert.ok(r.includes("revalidateTag(tag)"), "revalidateTag 调用");
  assert.ok(r.includes(".catch("), "非请求上下文（迁移脚本/CLI）catch 静默");
  assert.ok(r.includes("export function revalidateAfterChange"), "hook 工厂导出");
  // 红线：顶层 import next/cache 会让 payload CLI（--disable-transpile Node 原生 ESM）崩溃
  assert.ok(!/^import\s.*from\s+["']next\/cache["']/m.test(r), "禁止顶层 import next/cache");
});

// ─────────────────────── B) 全量 hook 注册 ───────────────────────
test("payload-hooks(B1): 7 业务 Collection 注册 afterChange + tag 命名规范", () => {
  for (const [name, tag] of Object.entries(COLLECTION_TAGS)) {
    const c = read(`src/collections/${name}.ts`);
    assert.ok(c.includes('from "./revalidate.ts"'), `${name} 引入 revalidate`);
    assert.ok(
      c.includes(`hooks: { afterChange: [revalidateAfterChange("${tag}")] }`),
      `${name} afterChange tag="${tag}"`,
    );
  }
});

test("payload-hooks(B2): 3 Global 注册 afterChange + tag 命名规范", () => {
  for (const [name, tag] of Object.entries(GLOBAL_TAGS)) {
    const g = read(`src/globals/${name}.ts`);
    assert.ok(g.includes('from "../collections/revalidate.ts"'), `${name} 引入 revalidate`);
    assert.ok(
      g.includes(`hooks: { afterChange: [revalidateAfterChange("${tag}")] }`),
      `${name} afterChange tag="${tag}"`,
    );
  }
});

// ─────────────────────── C) hooks tag ↔ loaders 失效 tag 对应 ───────────────────────
test("payload-hooks(C): 十个 hook tag 在 loaders.ts 均有对应缓存 tag", () => {
  const l = read("src/lib/cms/loaders.ts");
  for (const tag of [...Object.values(COLLECTION_TAGS), ...Object.values(GLOBAL_TAGS)]) {
    // 显式第 4 参（tag 与 key 不同名）或 key 本身（同名缺省）
    const explicit = l.includes(`  "${tag}",`);
    const asKey = l.includes(`withFallback(\n  "${tag}",`);
    assert.ok(explicit || asKey, `loaders 存在失效 tag "${tag}"`);
  }
});

// ─────────────────────── D) 挂载 ───────────────────────
test("payload-hooks(D): 本测试已挂载 npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-hooks.test.mjs"), "已挂载 npm test");
});
