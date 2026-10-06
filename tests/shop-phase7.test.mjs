/**
 * Phase 7 批次 3 · 装扮商城优化契约测试（2026-10-16）
 * ----------------------------------------------------------------
 * 对应《实施计划》7.6 + Phase 7 指令 3（落点：cosmetics 装扮弹窗 + /shop 道具商店）：
 *  A) 限时特惠横幅（7.6-1）：LimitedOfferBanner 三态（未登录/未首充/已首充），
 *     复用 Phase 4 事件总线 + first-purchase/status，不虚构折扣商品；
 *  B) 宠物穿戴预览（7.6-2）：petImageUrl prop + 点击装扮卡预览 + 立绘叠加；
 *  C) 我的收藏 tab（7.6-3）：全部/已拥有过滤 + 计数 + 空态；
 *  D) 推荐搭配（7.6-4）：最低价皮肤×特效规则型真实组合 + 点击定位高亮；
 *  E) 获取方式说明（7.6-5）：购买/签到盲盒/首充三行真实口径；
 *  F) /shop 挂载横幅 + companion-panel 传 avatar；
 *  G) i18n parity + 零 schema 红线。
 *
 * 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/shop-phase7.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ───────────── A) 限时特惠横幅（7.6-1）─────────────
test("phase7c(A1): LimitedOfferBanner——三态 + status API + 事件总线复用", () => {
  const b = read("../src/components/limited-offer-banner.tsx");
  assert.match(b, /fetch\("\/api\/user\/first-purchase\/status"/, "首充状态查询（Phase 4 既有 API）");
  assert.match(b, /d\.isFirstPurchase \? "firstPurchase" : "normal"/, "未首充→双倍文案");
  assert.match(b, /if \(!token\) \{\s*setOffer\("guest"\)/, "未登录→guest 态");
  assert.match(b, /notifyPointsInsufficient\(\{\}\)/, "点击走 Phase 4 事件总线（零支付逻辑）");
  assert.match(b, /firstTitle|firstSubtitle/, "首充双倍文案");
  // 诚实口径：不虚构限时折扣商品（promo_24h 挂接属 backlog，不提前宣传）
  assert.ok(!b.includes("promo_24h"), "不宣传未挂接商品");
});

// ───────────── B) 宠物穿戴预览（7.6-2）─────────────
test("phase7c(B1): 穿戴预览——petImageUrl prop + 点击卡片预览 + 立绘叠加", () => {
  const m = read("../src/components/cosmetics-shop-modal.tsx");
  assert.match(m, /petImageUrl\?: string \| null;/, "可选 prop");
  assert.match(m, /onClick=\{\(\) => setPreviewId\(c\.id\)\}/, "点击装扮卡设预览");
  assert.match(m, /previewItem \? \([\s\S]*?previewTitle", \{ name: previewItem\.name \}\)/, "预览区展示选中项");
  assert.match(m, /src=\{petImageUrl\}/, "宠物立绘");
  assert.match(m, /src=\{previewItem\.imageUrl\}/, "装扮图叠加");
  assert.match(m, /previewLocked", \{ price: previewItem\.priceCny \}\)/, "未购显示价格");
  // 购买按钮防冒泡（不触发预览切换）
  assert.match(m, /e\.stopPropagation\(\);\s*void buy\("cosmetic", c\.id\)/, "购买按钮 stopPropagation");
});

// ───────────── C) 我的收藏 tab（7.6-3）─────────────
test("phase7c(C1): tab 过滤——全部/已拥有 + 计数 + owned 空态", () => {
  const m = read("../src/components/cosmetics-shop-modal.tsx");
  assert.match(m, /tab === "owned" \? items\.filter\(\(c\) => c\.owned\) : items/, "visibleItems 过滤");
  assert.match(m, /items\.filter\(\(c\) => c\.owned\)\.length/, "ownedCount");
  assert.match(m, /t\("tabAll", \{ count: items\.length \}\)/, "全部计数");
  assert.match(m, /t\("tabOwned", \{ count: ownedCount \}\)/, "已拥有计数");
  assert.match(m, /tab === "owned" \? t\("ownedEmpty"\) : t\("empty"\)/, "owned 空态文案");
  assert.match(m, /visibleItems\.map/, "grid 数据源切换为过滤列表");
});

// ───────────── D) 推荐搭配（7.6-4）─────────────
test("phase7c(D1): 推荐搭配——最低价皮肤×特效真实组合 + 点击定位高亮", () => {
  const m = read("../src/components/cosmetics-shop-modal.tsx");
  assert.match(m, /c\.kind === kind[\s\S]*?Number\(a\.priceCny\) - Number\(b\.priceCny\)/, "按价格升序取最低价");
  assert.match(m, /skin && effect \? \{ skin, effect \} : null/, "两类齐备才成组合");
  assert.match(m, /setPreviewId\(recommendPair\.skin\.id\)/, "点击→预览皮肤");
  assert.match(m, /setRecommendFlashId\(recommendPair\.effect\.id\)/, "点击→高亮特效");
  assert.match(m, /recommendFlashId === c\.id \? "animate-pulse ring-2 ring-violet-500"/, "高亮脉冲样式");
});

// ───────────── E) 获取方式说明（7.6-5）─────────────
test("phase7c(E1): 获取说明——购买/签到盲盒/首充三行", () => {
  const m = read("../src/components/cosmetics-shop-modal.tsx");
  for (const k of ["howtoBuy", "howtoBlindbox", "howtoFirst"]) {
    assert.ok(m.includes(`t("${k}")`), `说明行 ${k}`);
  }
});

// ───────────── F) 挂载接线 ─────────────
test("phase7c(F1): /shop 挂横幅 + companion-panel 传 avatar + 弹窗内横幅", () => {
  const s = read("../src/components/aibi/shop-client.tsx");
  assert.match(s, /<LimitedOfferBanner \/>/, "/shop 顶部横幅");
  const cp = read("../src/components/pets/companion-panel.tsx");
  assert.match(cp, /petImageUrl=\{selectedPet\?\.avatar \?\? null\}/, "companion-panel 传宠物立绘");
  const m = read("../src/components/cosmetics-shop-modal.tsx");
  assert.match(m, /<LimitedOfferBanner className="mb-3" \/>/, "弹窗内横幅");
});

// ───────────── G) i18n parity + 零 schema ─────────────
test("phase7c(G1): i18n——offerBanner + cosmetics 新 key 双语 parity", () => {
  const zh = JSON.parse(read("../messages/zh.json"));
  const en = JSON.parse(read("../messages/en.json"));
  assert.deepEqual(Object.keys(zh.offerBanner).sort(), Object.keys(en.offerBanner).sort(), "offerBanner 双语");
  for (const k of ["ownedEmpty", "previewTitle", "previewOwned", "previewLocked", "recommendTip", "recommendGo", "tabAll", "tabOwned", "howtoBuy", "howtoBlindbox", "howtoFirst"]) {
    assert.ok(zh.cosmetics[k], `zh.cosmetics.${k}`);
    assert.ok(en.cosmetics[k], `en.cosmetics.${k}`);
  }
  const client = read("../src/db/client.ts");
  assert.match(client, /const SCHEMA_VERSION = 20;/, "SCHEMA_VERSION 本 Phase 无变更（20 由 Phase 8 提升）");
  const migrations = readdirSync(new URL("../drizzle", import.meta.url));
  assert.ok(!migrations.some((f) => /^003[6-9]|^00[4-9]\d/.test(f)), "无 0036+ 新迁移（0035 属 Phase 8）");
});
