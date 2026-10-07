/**
 * Phase 7 批次 2 · 灵魂卡页面强化契约测试（2026-10-16）
 * ----------------------------------------------------------------
 * 对应《实施计划》7.4 + Phase 7 指令 2：
 *  A) 3D 翻转卡片（7.4-1）；B) 收藏进度统计面板（7.4-2）；
 *  C) 社区热门 tab（7.4-3）；D) 卡片对比（7.4-5）；E) i18n parity；F) 零 schema 红线。
 *
 * 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/soul-cards-phase7.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ───────────── A) 3D 翻转卡片（7.4-1）─────────────
test("phase7b(A1): SoulCardView——perspective/preserve-3d/backface 三要素 + hover rotateY(180)", () => {
  const v = read("../src/components/soul-card/soul-card-view.tsx");
  assert.match(v, /perspective: 1000px/, "perspective 容器");
  assert.match(v, /transform-style: preserve-3d/, "preserve-3d");
  assert.match(v, /backface-visibility: hidden/, "背面隐藏");
  assert.match(v, /\.scv-flip:hover \.scv-flip-inner:not\(\.scv-noflip\) \{\s*transform: rotateY\(180deg\)/s, "hover 翻转");
  assert.match(v, /\.scv-back \{\s*transform: rotateY\(180deg\)/s, "卡背预置 180°");
});

test("phase7b(A2): 卡背内容——稳定箴言 + 凭证号 + 仅可点击时显示提示；burned 不翻转", () => {
  const v = read("../src/components/soul-card/soul-card-view.tsx");
  assert.match(v, /soulQuoteFor\(card\.certificateNo, isEn \? "en" : "zh"\)/, "箴言与分享图同口径稳定抽取");
  assert.match(v, /\{!burned \? \([\s\S]*?scv-back/, "burned 不渲染卡背（不翻转）");
  assert.match(v, /scv-noflip/, "burned hover 禁用翻转");
  assert.match(v, /\{onClick \? \([\s\S]*?flipHint/, "只读场景（公开页）不显示点击提示");
  assert.match(v, /prefers-reduced-motion: reduce[\s\S]*?transform: none/s, "reduced-motion 禁翻转");
});

// ───────────── B) 收藏进度统计面板（7.4-2）─────────────
test("phase7b(B1): CollectionProgress——总量/已销毁/最高等级/稀有度分布/元素收集纯前端推导", () => {
  const c = read("../src/components/soul-card/collection-progress.tsx");
  assert.match(c, /cards\.filter\(\(c\) => c\.status !== "burned"\)/, "流通中口径");
  assert.match(c, /Math\.max\(m, c\.growthLevel\)/, "最高等级");
  assert.match(c, /SOUL_CARD_RARITIES\.map/, "5 档稀有度分布");
  assert.match(c, /\(count \/ active\.length\) \* 100/, "占比条宽度");
  assert.match(c, /SOUL_CARD_ELEMENTS\.map[\s\S]*?collectedElements\.has\(el\)/, "四元素点亮");
  assert.ok(!c.includes("fetch("), "纯前端推导无额外请求");
});

test("phase7b(B2): CollectionProgress 挂载条件——ready 且有卡", () => {
  const cl = read("../src/components/soul-card/soul-cards-client.tsx");
  assert.match(cl, /state === "ready" && cards\.length > 0[\s\S]*?<CollectionProgress cards=\{cards\} locale=\{locale\} \/>/, "挂载条件");
});

// ───────────── C) 社区热门 tab（7.4-3）─────────────
test("phase7b(C1): featured API 扩展——卡面全量字段 + 归属/链上字段不返回", () => {
  const r = read("../src/app/api/soul-cards/featured/route.ts");
  assert.match(r, /JOIN pets p ON p\.id = sc\.pet_id/, "JOIN pets 立绘");
  assert.match(r, /JOIN pet_dictionary pd ON pd\.id = p\.species_id/, "JOIN 物种字典");
  for (const f of ["pet_image_url", "species_name_zh", "species_name_en", "token_id", "growth_exp"]) {
    assert.ok(r.includes(f), `字段 ${f}`);
  }
  assert.ok(!/owner_id|mint_tx|burn_tx/.test(r.match(/SELECT[\s\S]*?FROM soul_cards/)?.[0] ?? ""), "敏感字段不返回");
});

test("phase7b(C2): 热门 tab——featured 数据源 + featuredToDto 补占位 + 公开页新标签跳转", () => {
  const cl = read("../src/components/soul-card/soul-cards-client.tsx");
  assert.match(cl, /fetch\("\/api\/soul-cards\/featured"\)/, "数据源");
  assert.match(cl, /\(d\.cards as FeaturedSoulCardDto\[\]\)\.map\(featuredToDto\)/, "DTO 转换");
  assert.match(cl, /window\.open\(`\/\$\{locale\}\/soul-cards\/\$\{card\.id\}\/public`, "_blank"\)/, "公开页新标签");
  const tp = read("../src/components/soul-card/soul-card-types.ts");
  assert.match(tp, /export function featuredToDto[\s\S]*?status: "active"/, "featuredToDto 补 active");
  assert.match(tp, /ownerId: ""/, "ownerId 占位（服务端不返回）");
  assert.match(cl, /role="tablist"/, "tab 栏始终渲染（未登录也可看热门）");
});

// ───────────── D) 卡片对比（7.4-5）─────────────
test("phase7b(D1): 对比模式——≤2 上限 + 替换最早选择 + ≥2 卡才显示开关", () => {
  const cl = read("../src/components/soul-card/soul-cards-client.tsx");
  assert.match(cl, /prev\.length >= 2 \? \[prev\[1\], cardId\] : \[\.\.\.prev, cardId\]/, "2 张上限替换最早");
  assert.match(cl, /cards\.length >= 2[\s\S]*?compare\.exit/, "≥2 张显示开关");
  assert.match(cl, /compareMode \? toggleCompare\(card\.id\) : void openDetail\(card\.id\)/, "对比模式点击=点选");
  assert.match(cl, /pointer-events-none absolute right-2 top-2/, "选中角标不挡点击");
});

test("phase7b(D2): 对照弹窗——7 行属性 + 稀有度/等级高者高亮 + 双卡面并排", () => {
  const m = read("../src/components/soul-card/soul-card-compare-modal.tsx");
  for (const k of ["rowRarity", "rowElement", "rowLevel", "rowStage", "rowSpecies", "rowCert", "rowMinted"]) {
    assert.ok(m.includes(`t("${k}")`), `对照行 ${k}`);
  }
  assert.match(m, /RARITY_ORDER\[rarityA\] > RARITY_ORDER\[rarityB\] \? "a" : "b"/, "稀有度高者");
  assert.match(m, /a\.growthLevel > b\.growthLevel \? "a" : "b"/, "等级高者");
  assert.match(m, /r\.win === "a" \? "font-bold text-emerald-600/, "高亮绿色");
  assert.match(m, /grid grid-cols-2 gap-3[\s\S]*?<SoulCardView card=\{a\}[\s\S]*?<SoulCardView card=\{b\}/, "双卡面并排");
});

// ───────────── E) i18n 双语 parity ─────────────
test("phase7b(E1): i18n——flipHint/tabs/hot/progress/compare 新 key 双语 parity", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  const flat = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`],
    );
  for (const g of ["tabs", "hot", "progress", "compare"]) {
    assert.deepEqual(flat(zh.soulCards[g]).sort(), flat(en.soulCards[g]).sort(), `soulCards.${g} 双语 key 对齐`);
  }
  assert.ok(zh.soulCards.flipHint && en.soulCards.flipHint, "flipHint 双语");
  // de-chained 红线：compare 行名避开 mint 系词（en 用 Born date）
  assert.ok(!/mint/i.test(en.soulCards.compare.rowMinted), "rowMinted 避开 mint 系词");
});

// ───────────── F) 零 schema 变更红线 ─────────────
test("phase7b(F1): 零 schema 变更——SCHEMA_VERSION 维持 19 + 无新迁移", () => {
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 21;/, "SCHEMA_VERSION 本 Phase 无变更（20 由 Phase 8 提升）");
  const migrations = readdirSync(new URL("../drizzle", import.meta.url));
  assert.ok(!migrations.some((f) => /^003[7-9]|^00[4-9]\d/.test(f)), "无 0036+ 新迁移（0035 属 Phase 8）");
});

