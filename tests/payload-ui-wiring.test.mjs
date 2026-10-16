/**
 * 契约测试 · 前端接线（Commit 6 ui-wiring）
 *
 *  A) /world 世界观页：四板块改从 getStoriesByKind 取数（ISR 60s），
 *     渲染统一 CmsStory 形状（title/summary/extraOf），硬编码 import 清零；
 *  B) pet play/movie 双聚合 API：resolveSpeciesVisual → getSpeciesVisualById
 *     （物种视觉「改表即改站」，字段级兜底语义保持）；
 *  C) CmsBanner 组件：RSC async、空表零渲染红线、Lexical 纯文本提取、
 *     内外链分流；挂载 explore-v2（placement=explore-top）；
 *  D) Stories.extra 契约：collection json 字段 + loader 透传 + 迁移种子
 *     （region→type/element/representatives，life-form→subtitle/examples，creed→slogan）；
 *  E) 本测试已挂载 npm test。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────── A) /world 接线 ───────────────────────
test("payload-ui-wiring(A): /world 四板块 CMS 化 + ISR 60s + 硬编码清零", () => {
  const p = read("src/app/[locale]/world/page.tsx");
  assert.ok(p.includes('from "@/lib/cms/loaders"'), "引入 loaders");
  assert.ok(p.includes("export const revalidate = 60"), "ISR 60s（改表一分钟生效）");
  for (const kind of ['"region"', '"life-form"', '"creed"', '"glossary"']) {
    assert.ok(p.includes(`getStoriesByKind(${kind})`), `板块取数 ${kind}`);
  }
  for (const arr of ["regions.map", "lifeForms.map", "creeds.map", "glossary.map"]) {
    assert.ok(p.includes(arr), `渲染 ${arr}`);
  }
  assert.ok(p.includes("extraOf("), "extra 类型化读取 helper");
  // 硬编码数据源清零（页面不再 import worldview-data）
  assert.ok(!p.includes('from "@/lib/worldview-data"'), "不再直引 worldview-data");
  assert.ok(!p.includes("WORLD_REGIONS.map") && !p.includes("WORLD_VALUES.map"), "硬编码 map 清零");
});

// ─────────────────────── B) pet 双 API 视觉接线 ───────────────────────
test("payload-ui-wiring(B): play/movie 聚合 API 视觉走 CMS loader", () => {
  for (const f of ["src/app/api/pet/play/route.ts", "src/app/api/pet/movie/route.ts"]) {
    const r = read(f);
    assert.ok(r.includes('from "@/lib/cms/loaders"'), `${f} 引入 loaders`);
    assert.ok(r.includes("await getSpeciesVisualById("), `${f} await loader`);
    assert.ok(!r.includes("resolveSpeciesVisual("), `${f} 不再直调注册表`);
  }
});

// ─────────────────────── C) CmsBanner ───────────────────────
test("payload-ui-wiring(C1): CmsBanner 组件契约（RSC/零渲染红线/Lexical 提取/内外链）", () => {
  const c = read("src/components/cms/cms-banner.tsx");
  assert.ok(c.includes("export async function CmsBanner"), "RSC async 组件");
  assert.ok(c.includes("getBannersByPlacement(placement)"), "loader 取数");
  assert.ok(c.includes("if (banners.length === 0) return null"), "空表零渲染（不虚构红线）");
  assert.ok(c.includes("lexicalToText"), "Lexical 纯文本提取");
  assert.ok(c.includes('startsWith("http")'), "外链分流 target=_blank");
  assert.ok(c.includes('from "@/i18n/navigation"'), "内链走 i18n Link");
});

test("payload-ui-wiring(C2): explore-v2 挂载 explore-top 横幅位", () => {
  const p = read("src/app/[locale]/explore-v2/page.tsx");
  assert.ok(p.includes('from "@/components/cms/cms-banner"'), "引入 CmsBanner");
  assert.ok(p.includes('<CmsBanner placement="explore-top" locale={locale} />'), "挂载 explore-top");
  assert.ok(p.includes("<SeasonalEventBanner />"), "既有季节横幅保留");
});

// ─────────────────────── D) Stories.extra 契约 ───────────────────────
test("payload-ui-wiring(D): Stories.extra 三层一致（collection/loader/迁移）", () => {
  const col = read("src/collections/Stories.ts");
  assert.ok(col.includes('name: "extra"') && col.includes('type: "json"'), "collection extra json");
  const l = read("src/lib/cms/loaders.ts");
  assert.ok(l.includes("extra?: Record<string, unknown> | null"), "CmsStory.extra 类型");
  assert.ok(l.includes("representativesZh") && l.includes("subtitleZh") && l.includes("sloganZh"), "fallback 五类 extra");
  const s = read("scripts/payload-migrate.mjs");
  assert.ok(s.includes("representativesZh: r.representativesZh"), "迁移 region extra");
  assert.ok(s.includes("subtitleZh: f.titleZh"), "迁移 life-form extra（title→subtitle 语义区分）");
  assert.ok(s.includes("sloganZh: v.sloganZh"), "迁移 creed extra");
  const t = read("src/payload-types.ts");
  assert.ok(t.includes("extra?:"), "payload-types 含 extra");
});

// ─────────────────────── E) 挂载 ───────────────────────
test("payload-ui-wiring(E): 本测试已挂载 npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-ui-wiring.test.mjs"), "已挂载");
});
