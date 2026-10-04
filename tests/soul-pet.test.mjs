// 灵宠体系升级（2026-10-09「领养/我的宠物」→「我的灵宠」）契约测试：
//  1) soulNameFor 纯函数：四元素前缀（zh/en）+ 未知元素兜底 + 分隔符排版；
//  2) catalog API 双模式 soulName 派生接线（普通 + group=species，rep 口径）；
//  3) 图鉴页：soulName 优先展示 + 原型小字防冗余 + 拥有态视觉（虚线磨砂 / 流光高亮）；
//  4) 老用户升级公告：localStorage 幂等（版本化 key + 关闭持久化）；
//  5) 详情页：灵魂档案标识 + 灵魂名行 + variants 元素查询（rep 口径 = 最高稀有度版本）；
//  6) SEO 强约束回归：generateMetadata / JSON-LD 维持原型名（soulName 仅页面内展示）；
//  7) 导航撞名锁：「我的灵宠」≠「灵魂卡/收藏」（navAdoptMy vs navSoulCodex，zh/en）；
//  8) i18n 双语对齐：upgrade 三键 + soulArchiveLabel + 核心文案改值锁定；
//  9) globals.css：soul-card-glow / soul-shine-sweep 关键帧 + prefers-reduced-motion 降级；
// 10) URL 不变锁：/pets /pets/my /my-pets /pets/[id] 路由文件原位保留（零 301/308 迁移）。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/soul-pet.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SOUL_ELEMENT_PREFIX,
  SOUL_FALLBACK_PREFIX,
  soulNameFor,
} from "../src/lib/soul-pet.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// ---- 1) soulNameFor 纯函数 ----
test("soulNameFor: 四元素前缀 zh（水之灵·泡泡 格式，紧凑「·」）", () => {
  assert.equal(soulNameFor("water", "泡泡", "zh"), "水之灵·泡泡");
  assert.equal(soulNameFor("fire", "亚洲象", "zh"), "火之灵·亚洲象");
  assert.equal(soulNameFor("earth", "爪爪", "zh"), "地之灵·爪爪");
  assert.equal(soulNameFor("air", "波斯猫", "zh"), "风之灵·波斯猫");
});

test("soulNameFor: 四元素前缀 en（Water Spirit · Bubbles 格式，词间留空）", () => {
  assert.equal(soulNameFor("water", "Bubbles", "en"), "Water Spirit · Bubbles");
  assert.equal(soulNameFor("fire", "Elephant", "en"), "Fire Spirit · Elephant");
  assert.equal(soulNameFor("earth", "Inky", "en"), "Earth Spirit · Inky");
  assert.equal(soulNameFor("air", "Persian", "en"), "Wind Spirit · Persian");
});

test("soulNameFor: 未知/缺失元素 → 兜底前缀（魂之灵 / Soul Spirit），不返回空名", () => {
  assert.equal(soulNameFor("lightning", "泡泡", "zh"), "魂之灵·泡泡");
  assert.equal(soulNameFor(null, "泡泡", "zh"), "魂之灵·泡泡");
  assert.equal(soulNameFor(undefined, "Bubbles", "en"), "Soul Spirit · Bubbles");
  assert.equal(SOUL_FALLBACK_PREFIX.zh, "魂之灵");
  assert.deepEqual(Object.keys(SOUL_ELEMENT_PREFIX).sort(), ["air", "earth", "fire", "water"]);
});

// ---- 2) catalog API 双模式接线 ----
test("api: catalog 普通模式 + group=species 模式均派生 soulName（rep 口径），DB 零迁移", () => {
  const src = read("src/app/api/pets/catalog/route.ts");
  assert.ok(src.includes('import { soulNameFor } from "@/lib/soul-pet"'), "API 接入灵魂名单源");
  // 普通模式：实例 traits.element + aibiName/speciesName
  assert.ok(
    src.includes("soulName: soulNameFor(r.traits?.element, aibiName ?? speciesName, locale)"),
    "普通模式 soulName（实例元素）",
  );
  // group 模式：rep 实例元素 + rep.aibiName/speciesName（卡片展示字段取 rep）
  assert.ok(
    src.includes("c.rep.traits?.element") && src.includes("c.rep.aibiName ?? c.rep.speciesName"),
    "group 模式 soulName（rep 口径）",
  );
  // 向后兼容：speciesName / aibiName 字段保留，未被替换
  assert.ok(src.includes("speciesName,"), "speciesName 字段保留（向后兼容）");
  assert.ok(src.includes("aibiName,"), "aibiName 字段保留（向后兼容）");
});

// ---- 3) 图鉴页：soulName 展示 + 拥有态视觉 ----
test("catalog page: soulName 优先展示 + 原型小字防冗余（火之灵·亚洲象 不再标原型）", () => {
  const src = read("src/app/[locale]/pets/page.tsx");
  assert.ok(src.includes("soulName?: string"), "CatalogPet 类型含 soulName");
  assert.ok(
    src.includes("{pet.soulName ?? (showAibi ? pet.aibiName : pet.speciesName)}"),
    "展示名 soulName 优先",
  );
  assert.ok(
    src.includes("pet.soulName ? !!pet.aibiName : showAibi"),
    "原型小字仅灵魂名含角色名时显示",
  );
});

test("catalog page: 拥有态视觉 —— 未拥有虚线磨砂 / 已拥有流光高亮", () => {
  const src = read("src/app/[locale]/pets/page.tsx");
  assert.ok(src.includes('"soul-card-owned border-amber-300'), "已拥有：流光类 + 琥珀边框");
  assert.ok(src.includes('"relative border-dashed border-zinc-300 bg-white/60'), "未拥有：虚线边框 + 磨砂底");
  assert.ok(src.includes("opacity-75 grayscale-[0.45]"), "未拥有：立绘磨砂淡化");
  assert.ok(src.includes("bg-amber-100 text-amber-700"), "已拥有按钮高亮（已唤醒收藏态）");
});

// ---- 4) 老用户升级公告 ----
test("catalog page: 老用户升级公告 —— 版本化 localStorage key + 关闭持久化（一次性）", () => {
  const src = read("src/app/[locale]/pets/page.tsx");
  assert.ok(
    src.includes('UPGRADE_NOTICE_KEY = "aiabw_soul_upgrade_v1"'),
    "版本化公告 key（未来升级 bump 复用）",
  );
  assert.ok(src.includes("localStorage.getItem(UPGRADE_NOTICE_KEY)"), "读取幂等：已读不再弹");
  assert.ok(src.includes('localStorage.setItem(UPGRADE_NOTICE_KEY, "1")'), "关闭写入持久化");
  assert.ok(src.includes('t("upgradeTitle")') && src.includes('t("upgradeBody")'), "公告文案走 i18n");
  assert.ok(src.includes('t("upgradeDismiss")'), "关闭按钮走 i18n");
});

// ---- 5) 详情页：灵魂档案 + 灵魂名 ----
test("detail page: 灵魂档案标识 + 灵魂名行（rep 口径取最高稀有度版本元素）", () => {
  const src = read("src/app/[locale]/pets/[id]/page.tsx");
  assert.ok(src.includes('import { soulNameFor } from "@/lib/soul-pet"'), "详情页接入灵魂名单源");
  assert.ok(src.includes("t(\"soulArchiveLabel\")"), "灵魂档案标识渲染");
  assert.ok(
    src.includes("soulNameFor(variants[0]?.element, aibi ?? name, locale)"),
    "灵魂名 = 最高稀有度版本元素 + 艾比名/原型名",
  );
  assert.ok(
    src.includes("(array_agg(p.traits->>'element'))[1] AS element"),
    "variants 查询携带元素列",
  );
});

// ---- 6) SEO 强约束回归 ----
test("detail page: SEO 强约束 —— title/OG/JSON-LD 维持原型名，soulName 仅页面内", () => {
  const src = read("src/app/[locale]/pets/[id]/page.tsx");
  const meta = src.slice(src.indexOf("export async function generateMetadata"));
  const metaBody = meta.slice(0, meta.indexOf("export default"));
  assert.ok(metaBody.includes('t("petDetailTitle", { name })'), "metadata title 仍用原型名");
  assert.ok(!metaBody.includes("soulName"), "generateMetadata 不消费 soulName（SEO 不变量）");
  const jsonLd = src.slice(src.indexOf('"@type": "Product"'), src.indexOf("<div className=\"mx-auto max-w-3xl\">"));
  assert.ok(!jsonLd.includes("soulName"), "JSON-LD 不消费 soulName（结构化数据不变量）");
});

// ---- 7) 导航撞名锁 ----
test("nav: 「我的灵宠」与「灵魂卡/收藏」不撞名（产品决策锁）", () => {
  assert.equal(zh.nav.navAdoptMy, "🐾 我的灵宠");
  assert.equal(en.nav.navAdoptMy, "🐾 My Soul Pets");
  assert.notEqual(zh.nav.navAdoptMy, zh.nav.navSoulCodex, "zh 主入口不与灵魂卡/收藏撞名");
  assert.notEqual(en.nav.navAdoptMy, en.nav.navSoulCodex, "en 主入口不与灵魂卡/收藏撞名");
  assert.ok(!zh.nav.navAdoptMy.includes("灵魂卡"), "zh 主入口不含「灵魂卡」（= soul_cards 凭证专名）");
  assert.ok(!en.nav.navAdoptMy.includes("Soul Card"), "en 主入口不含「Soul Card」");
});

// ---- 8) i18n 双语对齐 ----
test("i18n: upgrade 三键 + soulArchiveLabel zh/en 对齐", () => {
  for (const k of ["upgradeTitle", "upgradeBody", "upgradeDismiss"]) {
    assert.ok(zh.petsCatalog[k], `zh petsCatalog.${k} 存在`);
    assert.ok(en.petsCatalog[k], `en petsCatalog.${k} 存在`);
  }
  assert.equal(zh.seo.soulArchiveLabel, "📜 灵魂档案");
  assert.equal(en.seo.soulArchiveLabel, "📜 Soul Archive");
});

test("i18n: 核心文案改值锁定（唤醒灵魂 / 已唤醒 / 灵宠图鉴 / 灵魂档案）", () => {
  assert.equal(zh.petsCatalog.get, "唤醒灵魂");
  assert.equal(en.petsCatalog.get, "Awaken Soul");
  assert.equal(zh.petsCatalog.claimed, "已唤醒");
  assert.equal(en.petsCatalog.claimed, "Awakened");
  assert.equal(zh.petsCatalog.title, "灵宠图鉴");
  assert.equal(en.petsCatalog.title, "Soul Pet Codex");
  assert.equal(zh.petsCatalog.detail, "灵魂档案");
  assert.equal(en.petsCatalog.detail, "Soul Archive");
  assert.equal(zh.myPets.title, "我的灵宠");
  assert.equal(en.myPets.title, "My Soul Pets");
  assert.ok(zh.seo.petDetailTitle.includes("灵魂档案"), "详情页 SEO 标题 = 灵魂档案");
  assert.ok(en.seo.petDetailTitle.includes("Soul Pet Archive"), "en 详情页 SEO 标题同步");
});

// ---- 9) globals.css 流光样式 ----
test("css: 已拥有卡片流光关键帧 + prefers-reduced-motion 降级", () => {
  const css = read("src/app/globals.css");
  for (const kf of ["soul-card-glow", "soul-shine-sweep"]) {
    assert.ok(css.includes(`@keyframes ${kf}`), `missing @keyframes ${kf}`);
  }
  assert.ok(css.includes(".soul-card-owned"), "已拥有卡片类定义");
  assert.ok(css.includes(".soul-card-owned::after"), "流光扫掠伪元素");
  // 降级块内停用动画（keyframe 只用 transform/opacity/box-shadow，不动 layout）
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(reduced.includes(".soul-card-owned"), "减弱动效降级覆盖 soul-card-owned");
  assert.ok(!/@keyframes soul[^{]*\{[^}]*(?:width|height|top|left|margin|padding):/.test(css), "关键帧不动 layout 属性");
});

// ---- 10) URL 锁（2026-10-09 双页合并修订）----
// 原锁「四路由原位零迁移」针对灵宠体系升级（保 SEO）；2026-10-09 双页合并（backlog P2）
// 经用户批准将 /my-pets 308 → /pets/my，本锁相应修订为：
// /pets /pets/my /pets/[id] 原位不变 + /my-pets 以 308 重定向页形式保留（URL 兼容）。
test("routes: /pets /pets/my /pets/[id] 原位 + /my-pets 308 → /pets/my（双页合并修订）", () => {
  for (const rel of [
    "src/app/[locale]/pets/page.tsx",
    "src/app/[locale]/pets/my/page.tsx",
    "src/app/[locale]/pets/[id]/page.tsx",
  ]) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} 原位保留`);
  }
  // /my-pets 不删除、不 404：以 308 永久重定向页保留（与 /explore → /explore-v2 同模式）
  const myPetsRedirect = read("src/app/[locale]/my-pets/page.tsx");
  assert.ok(myPetsRedirect.includes("permanentRedirect"), "/my-pets 必须是 308 重定向页");
  assert.ok(myPetsRedirect.includes("/pets/my"), "/my-pets 重定向目标必须是 /pets/my");
  assert.ok(!myPetsRedirect.includes("use client"), "/my-pets 不再承载客户端页面逻辑");
  const sitemap = read("src/app/sitemap.ts");
  assert.ok(sitemap.includes("/pets/${String(s.id)}"), "sitemap 详情页 URL 形态不变");
  assert.ok(sitemap.includes("/pets/my") && !sitemap.includes('"/my-pets"'), "sitemap 只列终态 URL /pets/my");
  const header = read("src/components/layout/SiteHeader.tsx");
  assert.ok(header.includes('href: "/pets"'), "导航主入口仍指向 /pets（URL 不变）");
  assert.ok(header.includes('href: "/pets/my"'), "导航我的灵宠指向合并后 /pets/my");
});
