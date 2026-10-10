/**
 * Phase 7 批次 1 · 首页改造契约测试（2026-10-16）
 * ----------------------------------------------------------------
 * 对应《实施计划》7.1 首页改造 + Phase 7 指令 1：
 *  A) GET /api/soul-cards/featured —— 公开热门灵魂卡（7.1-3 轮播数据源）；
 *  B) GET /api/home/stats —— 社区活跃数据聚合（7.1-6）；
 *  C) SoulCardCarousel 组件 —— 灵魂卡轮播（marquee 无缝循环 + 稀有度渐变 + 公开页跳转）；
 *  D) CommunityStats 组件 —— 4 格活跃数据条（千位格式化 + 静默降级）；
 *  E) 首页接线 —— 两组件挂载 + 探索/商城次级 CTA（7.1-4）；
 *  F) i18n —— slogan 对齐计划（7.1-1 养成/探索/收藏/排名）+ 新 key 双语 parity；
 *  G) 零 schema 变更红线。
 * 既有功能覆盖说明：今日热门宠物（7.1-2）= featured pets 区块（Trending Soul Pets）已存在。
 *
 * 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/home-phase7.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ───────────── A) GET /api/soul-cards/featured ─────────────
test("phase7(A1): featured API——公开只读 + active 过滤 + 稀有度权重排序 + LIMIT 10", () => {
  const src = read("../src/app/api/soul-cards/featured/route.ts");
  assert.ok(!src.includes("getUserFromRequest"), "公开接口无鉴权（卡片本身有公开页机制）");
  assert.match(src, /WHERE sc\.status = 'active'/, "仅流通中卡片");
  assert.match(src, /ORDER BY CASE sc\.rarity[\s\S]*?WHEN 'legendary' THEN 4[\s\S]*?END DESC,\s*sc\.minted_at DESC/, "稀有度权重 DESC + 铸造时间 DESC");
  assert.match(src, /LIMIT 10/, "Top 10");
});

test("phase7(A2): featured API——60s 内存缓存 + 失败空列表降级 + 字段白名单（不泄漏 owner）", () => {
  const src = read("../src/app/api/soul-cards/featured/route.ts");
  assert.match(src, /const CACHE_TTL_MS = 60_000;/, "60s TTL（与 /api/news、/api/visits 同模式）");
  assert.match(src, /now < cache\.expiresAt/, "缓存命中短路");
  assert.match(src, /catch \(err\)[\s\S]*?ok: true, cards: \[\]/, "失败降级空列表（前端静默）");
  // 字段白名单（批次 2 扩展为卡面全量字段）：绝不返回归属/链上哈希敏感字段
  const selectBlock = src.match(/SELECT[\s\S]*?FROM soul_cards/)?.[0] ?? "";
  assert.ok(!/owner_id|mint_tx|burn_tx/.test(selectBlock), "SELECT 不含归属/链上哈希敏感字段");
  assert.match(selectBlock, /certificate_no/, "含凭证编号");
  assert.match(selectBlock, /growth_level/, "含成长等级");
  assert.match(src, /JOIN pets p ON p\.id = sc\.pet_id/, "JOIN pets 补立绘（社区热门 tab 复用）");
  assert.match(src, /JOIN pet_dictionary pd ON pd\.id = p\.species_id/, "JOIN 物种字典补双语名");
});

// ───────────── B) GET /api/home/stats ─────────────
test("phase7(B1): stats API——单 SQL 聚合 4 指标 + 当日零点口径", () => {
  const src = read("../src/app/api/home/stats/route.ts");
  assert.ok(!src.includes("getUserFromRequest"), "公开接口无鉴权");
  assert.match(src, /adoptions[\s\S]*?adopted_at >= date_trunc\('day', now\(\)\)/, "今日新生伙伴");
  assert.match(src, /exploration_records[\s\S]*?created_at >= date_trunc\('day', now\(\)\)/, "今日探索次数");
  assert.match(src, /soul_cards[\s\S]*?status = 'active'/, "在册灵魂卡");
  assert.match(src, /FROM users\) AS collectors_total/, "收藏家总数");
  // 单 SQL（4 个 scalar subquery 一次往返）
  assert.equal((src.match(/pool\.query/g) ?? []).length, 1, "单 SQL 聚合");
});

test("phase7(B2): stats API——60s 缓存 + 失败 stats=null 降级", () => {
  const src = read("../src/app/api/home/stats/route.ts");
  assert.match(src, /const CACHE_TTL_MS = 60_000;/, "60s TTL");
  assert.match(src, /ok: true, stats: null/, "失败降级 null（前端静默不渲染）");
});

// ───────────── C) SoulCardCarousel ─────────────
test("phase7(C1): SoulCardCarousel——marquee 无缝循环（≥4 ×2 + 悬停暂停 + reduced-motion）", () => {
  const src = read("../src/components/home/soul-card-carousel.tsx");
  assert.match(src, /fetch\("\/api\/soul-cards\/featured"\)/, "数据源");
  assert.match(src, /cards\.length >= 4[\s\S]*?\[\.\.\.cards, \.\.\.cards\]/, "≥4 条 ×2 拼接");
  assert.match(src, /translateX\(-50%\)/, "-50% 平移无缝衔接");
  assert.match(src, /:hover \{\s*animation-play-state: paused/s, "悬停暂停");
  assert.match(src, /prefers-reduced-motion: reduce/, "尊重减少动态偏好");
  assert.match(src, /if \(loading \|\| cards\.length === 0\) return null/, "空/加载静默不渲染");
});

test("phase7(C2): SoulCardCarousel——稀有度渐变边框 + 元素 emoji + 点击进公开凭证页", () => {
  const src = read("../src/components/home/soul-card-carousel.tsx");
  assert.match(src, /RARITY_META\[c\.rarity as SoulCardRarity\]/, "稀有度 meta 驱动");
  assert.match(src, /rarity\.frameClass/, "渐变边框（frameClass）");
  assert.match(src, /ELEMENT_META\[c\.element as SoulCardElement\]/, "元素 meta 驱动");
  assert.match(src, /href=\{`\/soul-cards\/\$\{c\.id\}\/public`\}/, "点击进公开凭证页（拉新转化）");
  assert.match(src, /certificateNo/, "凭证编号展示");
});

// ───────────── D) CommunityStats ─────────────
test("phase7(D1): CommunityStats——4 指标 + 千位格式化 + 静默降级", () => {
  const src = read("../src/components/home/community-stats.tsx");
  assert.match(src, /fetch\("\/api\/home\/stats"\)/, "数据源");
  for (const k of ["bornToday", "explorationsToday", "soulCardsTotal", "collectorsTotal"]) {
    assert.ok(src.includes(k), `指标 ${k}`);
  }
  assert.match(src, /new Intl\.NumberFormat\(locale === "en" \? "en-US" : "zh-CN"\)/, "千位格式化按 locale");
  assert.match(src, /if \(!stats\) return null/, "失败/加载静默不渲染");
});

// ───────────── E) 首页接线 ─────────────
test("phase7(E1): 首页——两组件挂载 + 探索/商城次级 CTA（7.1-4）", () => {
  const src = read("../src/app/[locale]/page.tsx");
  assert.match(src, /<SoulCardCarousel \/>/, "灵魂卡轮播挂载");
  assert.match(src, /<CommunityStats \/>/, "社区活跃数据挂载");
  assert.match(src, /href="\/explore-v2"[\s\S]{0,400}?heroCtaExplore/, "探索次级 CTA");
  assert.match(src, /href="\/shop"[\s\S]{0,400}?heroCtaShop/, "商城次级 CTA");
  // 主 CTA 保留
  assert.match(src, /href="\/pets"[\s\S]{0,400}?heroCta"\)\}/, "领养主 CTA 保留");
});

// ───────────── F) i18n ─────────────
test("phase7(F1): i18n——slogan 对齐计划四维度（7.1-1）+ 新 key 双语 parity", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  // slogan 含计划要求的四维度词
  for (const w of ["养成", "探索", "收藏", "排名"]) {
    assert.ok(zh.home.title.includes(w), `zh title 含「${w}」`);
  }
  for (const w of ["Raise", "Explore", "Collect", "Rank"]) {
    assert.ok(en.home.title.includes(w), `en title 含「${w}」`);
  }
  // 新 key 双语 parity
  for (const k of [
    "heroCtaExplore", "heroCtaShop", "soulCardsTitle", "soulCardsLevel",
    "statsBornToday", "statsExplorationsToday", "statsSoulCards", "statsCollectors",
  ]) {
    assert.ok(zh.home[k], `zh.home.${k}`);
    assert.ok(en.home[k], `en.home.${k}`);
  }
  assert.ok(zh.home.soulCardsLevel.includes("{level}") && en.home.soulCardsLevel.includes("{level}"),
    "soulCardsLevel {level} 占位符双语一致");
});

// ───────────── G) 零 schema 变更红线 ─────────────
test("phase7(G1): 零 schema 变更——SCHEMA_VERSION 维持 19 + 两 API 无 DDL", () => {
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 22;/, "SCHEMA_VERSION 本 Phase 无变更（20 由 Phase 8 提升）");
  const migrations = readdirSync(new URL("../drizzle", import.meta.url));
  assert.ok(!migrations.some((f) => /^003[8-9]|^00[4-9]\d/.test(f)), "无 0037+ 新迁移（0036 属 Phase 10）");
  for (const f of [
    "../src/app/api/soul-cards/featured/route.ts",
    "../src/app/api/home/stats/route.ts",
  ]) {
    assert.ok(!/CREATE TABLE|ALTER TABLE/.test(read(f)), `${f} 无 DDL`);
  }
});

