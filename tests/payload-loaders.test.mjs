/**
 * 契约测试 · CMS 数据加载层（Commit 4 loaders）
 *
 *  A) payload.ts 单例与可用性闸：PAYLOAD_CMS_DISABLE 熔断 / TURSO 判定 /
 *     本地 file: 口径与 config 一致 / 初始化失败解除缓存重试；
 *  B) loaders.ts 九 loader 齐全且全部带降级链（withFallback 封装 + unstable_cache 60s）；
 *  C) 降级数据源接线：SPECIES_VISUALS / resolveSpeciesVisual / MOOD_ACTION_MAP /
 *     worldview-data 五表 / AIBI_ITEMS——空表永不空白；
 *  D) 业务语义闸：stories 仅 published、banners 时间窗+priority、products 仅上架、
 *     token-rules 仅 enabled、page 未命中 null；
 *  E) 服务端专用红线与类型对齐（@/payload-types 生成类型）；本测试已挂载。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) payload.ts ───────────────────────
test("payload-loaders(A): 单例 + 三道可用性闸 + 失败重试", () => {
  const p = read("src/lib/cms/payload.ts");
  assert.ok(p.includes('PAYLOAD_CMS_DISABLE === "1"'), "全局熔断开关");
  assert.ok(p.includes("TURSO_DATABASE_URL"), "Turso env 判定");
  assert.ok(p.includes('process.env.NODE_ENV !== "production"'), "本地 file: 口径");
  assert.ok(p.includes("getPayload({ config: configPromise })"), "Local API 单例");
  assert.ok(p.includes("cached = null"), "初始化失败解除缓存（下次重试）");
});

// ─────────────────────── B) 十二 loader 与降级链封装 ───────────────────────
test("payload-loaders(B1): 十二 loader 全部导出（Global 拆三 + 规则列表）", () => {
  const l = read("src/lib/cms/loaders.ts");
  for (const name of [
    "getSpeciesList", "getSpeciesVisualById", "getPetAnimationMap", "getStoriesByKind",
    "getPageBySlug", "getBannersByPlacement", "getProductList", "getTokenRuleByKey",
    "getTokenRuleList", "getSiteSettings", "getHomeHero", "getPointsEconomy",
  ]) {
    assert.ok(l.includes(`export const ${name}`), `loader ${name}`);
  }
  assert.ok(!l.includes("getCmsGlobal"), "共用 global loader 已拆分为三独立 loader（各自失效 tag）");
});

test("payload-loaders(B2): withFallback 封装 = cmsEnabled 闸 + try/catch + 60s 缓存 + 失效 tag", () => {
  const l = read("src/lib/cms/loaders.ts");
  assert.ok(l.includes("unstable_cache"), "unstable_cache");
  assert.ok(l.includes("revalidate: 60"), "缓存 60s（任务书规格）");
  assert.ok(l.includes("tags: [tag ?? key]"), "失效 tag（任务六 revalidateTag 对应）");
  assert.ok(l.includes("cmsEnabled()"), "第一道闸");
  assert.ok(l.includes("catch (err)"), "第二道闸 try/catch");
  assert.ok((l.match(/withFallback\(/g) ?? []).length >= 12, "十二 loader 全部经 withFallback 封装");
  assert.ok(l.includes("overrideAccess: true"), "Local API 服务端读取绕 access（读公开语义）");
});

test("payload-loaders(B3): 失效 tag 命名对齐任务六规范", () => {
  const l = read("src/lib/cms/loaders.ts");
  // 与 collections/globals afterChange hook 的 revalidateAfterChange("<tag>") 一一对应
  for (const tag of [
    '"species"', '"pet-animations"', '"pages"', '"token-rules"',
    '"site-settings"', '"home-hero"', '"points-economy"',
  ]) {
    assert.ok(l.includes(`  ${tag},`) || l.includes(`"${tag.slice(1, -1)}",\n`), `loader tag ${tag}`);
  }
  // stories / banners / products key 与 tag 同名（缺省 = key，无需显式第 4 参）
  for (const key of ['"stories",', '"banners",', '"products",']) {
    assert.ok(l.includes(key), `key=tag 同名 loader ${key}`);
  }
});

// ─────────────────────── C) 降级数据源接线 ───────────────────────
test("payload-loaders(C): 降级链接线现有注册表（空表永不空白）", () => {
  const l = read("src/lib/cms/loaders.ts");
  assert.ok(l.includes("SPECIES_VISUALS"), "物种回退注册表");
  assert.ok(l.includes("resolveSpeciesVisual"), "视觉回退函数（同形状）");
  assert.ok(l.includes("MOOD_ACTION_MAP"), "动画映射回退代码契约");
  for (const t of ["WORLD_REGIONS", "WORLD_LIFE_FORMS", "WORLD_VALUES", "WORLD_GLOSSARY", "WORLD_ANCIENTS"]) {
    assert.ok(l.includes(t), `世界观回退 ${t}`);
  }
  assert.ok(l.includes("AIBI_ITEMS"), "商品回退 aibi-catalog");
});

// ─────────────────────── D) 业务语义闸 ───────────────────────
test("payload-loaders(D): 查询语义闸（published/enabled/时间窗/priority）", () => {
  const l = read("src/lib/cms/loaders.ts");
  assert.ok(l.includes('published: { equals: true }'), "stories 仅已发布");
  assert.ok(l.includes('status: { equals: "published" }'), "pages 仅已发布");
  assert.ok(l.includes("Date.parse(d.startAt)") && l.includes("Date.parse(d.endAt)"), "banners 时间窗过滤");
  assert.ok(l.includes('sort: "-priority"'), "banners 优先级排序");
  assert.ok(l.includes("enabled: { equals: true }"), "products/token-rules 仅启用");
  assert.ok(l.includes("物种覆写") || l.includes("apply(res.docs.filter((r) => r.species == null))"), "动画映射全局默认+物种覆写合并");
});

// ─────────────────────── E) 红线与挂载 ───────────────────────
test("payload-loaders(E): 生成类型引用 + 服务端专用注释 + 本测试挂载", () => {
  const l = read("src/lib/cms/loaders.ts");
  assert.ok(l.includes('from "@/payload-types"'), "生成类型引用");
  assert.ok(l.includes("服务端专用"), "服务端专用红线注释");
  const p = read("src/lib/cms/payload.ts");
  assert.ok(p.includes("禁止客户端 import"), "payload.ts 客户端红线注释");
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-loaders.test.mjs"), "已挂载 npm test");
});
