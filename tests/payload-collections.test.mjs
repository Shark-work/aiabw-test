/**
 * 契约测试 · Payload 内容 Collections（Commit 2 collections）
 *
 *  A) 七 Collection 注册进 payload.config（.ts 显式扩展名红线）；
 *  B) 各 Collection 关键字段契约（与现有硬编码数据源镜像，供 Commit 5 迁移导入）：
 *     Species↔species-visuals/characters 展示层；PetAnimations↔sm-contract 枚举红线；
 *     Stories↔worldview-data；Pages/Banners/Products/TokenRules↔运营配置；
 *  C) 统一访问策略（读公开 + 写仅 admin，isAdmin saveToJWT 零查询）；
 *  D) 生成物：importMap 含 lexical 条目（richText 入图）、payload-types 含新 slug；
 *  E) 本测试已挂载 npm test。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const SEVEN = ["Species", "PetAnimations", "Stories", "Pages", "Banners", "Products", "TokenRules"];

// ─────────────────────── A) 注册与扩展名红线 ───────────────────────
test("payload-collections(A): 七 Collection 全部注册且导入带 .ts 扩展名", () => {
  const cfg = read("payload.config.ts");
  for (const name of SEVEN) {
    assert.ok(cfg.includes(`import { ${name} } from "./src/collections/${name}.ts"`), `${name} 导入带 .ts`);
    assert.ok(!cfg.includes(`from "./src/collections/${name}"`), `${name} 禁止无扩展名导入`);
  }
  const arrMatch = cfg.match(/collections:\s*\[([^\]]+)\]/);
  assert.ok(arrMatch, "collections 数组存在");
  for (const name of ["Users", "Media", ...SEVEN]) {
    assert.ok(arrMatch[1].includes(name), `collections 数组含 ${name}`);
  }
});

// ─────────────────────── B) 字段契约 ───────────────────────
test("payload-collections(B1): Species 镜像 species-visuals + 角色展示层", () => {
  const c = read("src/collections/Species.ts");
  assert.ok(c.includes('slug: "species"'), "slug");
  for (const f of ["speciesId", "nameZh", "nameEn", "personality", "greetingZh", "greetingEn", "rivePath", "staticImage", "sceneTheme", "sortOrder"]) {
    assert.ok(c.includes(`name: "${f}"`), `字段 ${f}`);
  }
  assert.ok(c.includes("unique: true"), "speciesId 唯一");
  // 防抄袭红线：prompt/台词库不入库
  assert.ok(!c.includes("buildSystemPrompt") && !c.includes("linesZh"), "System Prompt/台词库不进 CMS");
});

test("payload-collections(B2): PetAnimations 枚举锁死契约值（7 情绪/9 动作/5 Trigger）", () => {
  const c = read("src/collections/PetAnimations.ts");
  assert.ok(c.includes('slug: "pet-animations"'), "slug");
  for (const m of ["idle", "happy", "sad", "angry", "hungry", "thinking", "sleepy"]) {
    assert.ok(c.includes(`value: "${m}"`), `情绪枚举 ${m}`);
  }
  for (const a of ["eat", "sleep", "think", "wave", "rub"]) {
    assert.ok(c.includes(`value: "${a}"`), `动作枚举 ${a}`);
  }
  for (const t of ["pet", "play", "wake"]) {
    assert.ok(c.includes(`value: "${t}"`), `Trigger 枚举 ${t}`);
  }
  assert.ok(c.includes('relationTo: "species"'), "物种关联（留空=全局默认）");
  assert.ok(c.includes("intensityDefault") && c.includes("max: 2"), "强度 0-2");
});

test("payload-collections(B3): Stories 世界观七类 + 双语 richText + 发布闸", () => {
  const c = read("src/collections/Stories.ts");
  assert.ok(c.includes('slug: "stories"'), "slug");
  for (const k of ["creation-myth", "region", "life-form", "creed", "glossary", "ancient-legend", "card-story"]) {
    assert.ok(c.includes(`value: "${k}"`), `类别 ${k}`);
  }
  for (const f of ["contentZh", "contentEn"]) {
    assert.ok(c.includes(`name: "${f}"`), `richText 字段 ${f}`);
  }
  assert.ok((c.match(/type: "richText"/g) ?? []).length === 2, "恰好两个 richText（双语正文）");
  assert.ok(c.includes('name: "published"'), "发布闸（loader 只见已发布）");
});

test("payload-collections(B4): Pages slug 唯一 + richText 正文 + 草稿态", () => {
  const c = read("src/collections/Pages.ts");
  assert.ok(c.includes('slug: "pages"'), "slug");
  assert.ok(c.includes("unique: true"), "slug 唯一");
  for (const f of ["bodyZh", "bodyEn"]) {
    assert.ok(c.includes(`name: "${f}"`), `richText 字段 ${f}`);
  }
  assert.ok(c.includes('value: "draft"') && c.includes('value: "published"'), "draft/published 状态");
  assert.ok(c.includes("seoTitleZh") && c.includes("seoDescEn"), "SEO 字段");
});

test("payload-collections(B5): Banners 五投放位 + richText + 时间窗 + Media 双轨", () => {
  const c = read("src/collections/Banners.ts");
  assert.ok(c.includes('slug: "banners"'), "slug");
  for (const p of ["home-hero", "shop-top", "explore-top", "pet-play", "global-topbar"]) {
    assert.ok(c.includes(`value: "${p}"`), `投放位 ${p}`);
  }
  assert.ok(c.includes('name: "content"') && c.includes('type: "richText"'), "content richText（任务书规格）");

test("payload-collections(B6): Products 五类型 + 价格红线（≥1 元）+ 效果负载", () => {
  const c = read("src/collections/Products.ts");
  assert.ok(c.includes('slug: "products"'), "slug");
  assert.ok(c.includes('name: "productId"') && c.includes("unique: true"), "productId 唯一");
  for (const k of ["consumable", "skin", "effect", "pack", "bundle"]) {
    assert.ok(c.includes(`value: "${k}"`), `类型 ${k}`);
  }
  assert.ok(c.includes('name: "effectPayload"') && c.includes('type: "json"'), "effectPayload json");
  assert.ok(c.includes('name: "priceCny"') && c.includes("min: 1"), "价格红线：最低 1 元");
  assert.ok(c.includes('name: "pricePoints"') && c.includes("required: true"), "积分价必填");
});

test("payload-collections(B7): TokenRules 规则键唯一 + 正奖负扣 + 限额冷却", () => {
  const c = read("src/collections/TokenRules.ts");
  assert.ok(c.includes('slug: "token-rules"'), "slug");
  assert.ok(c.includes('name: "ruleKey"') && c.includes("unique: true"), "ruleKey 唯一");
  assert.ok(c.includes('name: "points"') && c.includes("required: true"), "points 必填");
  assert.ok(c.includes('name: "dailyLimit"'), "每日上限");
  assert.ok(c.includes('name: "cooldownMinutes"'), "冷却分钟");
  assert.ok(c.includes('name: "enabled"'), "启用闸");
});

// ─────────────────────── C) 统一访问策略 ───────────────────────
test("payload-collections(C): 七 Collection 统一 publicReadAdminWrite", () => {
  const access = read("src/collections/access.ts");
  assert.ok(access.includes("read: () => true"), "读公开");
  assert.ok(access.includes('req.user?.role === "admin"'), "写仅 admin（saveToJWT 零查询）");
  for (const name of SEVEN) {
    const c = read(`src/collections/${name}.ts`);
    assert.ok(c.includes('from "./access.ts"'), `${name} 引入公共 access（.ts 扩展名）`);
    assert.ok(c.includes("access: publicReadAdminWrite"), `${name} 应用统一策略`);
  }
});

// ─────────────────────── D) 生成物 ───────────────────────
test("payload-collections(D1): importMap 含 lexical 条目（richText 字段入图）", () => {
  const im = read("src/app/admin/importMap.ts");
  assert.ok(im.includes("@payloadcms/richtext-lexical/rsc"), "lexical rsc 组件入图");
  assert.ok(im.includes("RscEntryLexicalField"), "Lexical 字段组件");
});

test("payload-collections(D2): payload-types 含七新 slug 类型", () => {
  const t = read("src/payload-types.ts");
  for (const slug of ["species", "pet-animations", "stories", "pages", "banners", "products", "token-rules"]) {
    assert.ok(t.includes(slug), `payload-types 含 ${slug}`);
  }
});

test("payload-collections(E): 本测试已挂载 npm test", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.includes("payload-collections.test.mjs"), "已挂载");
});

  assert.ok(c.includes('name: "image"') && c.includes('relationTo: "media"'), "image upload→media");
  assert.ok(c.includes('name: "imagePath"'), "imagePath public 兜底");
  assert.ok(c.includes('name: "startAt"') && c.includes('name: "endAt"'), "时间窗");
  assert.ok(c.includes('name: "priority"'), "优先级");
});
