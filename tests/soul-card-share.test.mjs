/**
 * P2 社交传播 · 灵魂卡分享增强契约测试（改动一）
 *
 * 覆盖（验收口径：分享图含编号/阶段/箴言/水印，可分享/下载，公开页含唤醒入口）：
 *  1) soulQuoteFor：双语箴言池 8 条 + 同编号稳定抽取 + locale 分流；
 *  2) share.png：四档阶段徽章（纯 CSS 圆点）+ 箴言渲染 + SITE_URL 派生水印（不再硬编码）；
 *  3) SoulCardStory：分享按钮 → navigator.share（files+预填文案）→ 下载降级 → 新标签兜底；
 *  4) /soul-cards/[id]/public：noindex + active 过滤 + 404 + 只读卡面 + /register CTA；
 *  5) i18n：share.text 三参数 + public 3 key（zh/en 对齐）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SOUL_QUOTES_EN,
  SOUL_QUOTES_ZH,
  soulQuoteFor,
} from "../src/lib/soul-card-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) 灵魂箴言池 ===
test("soul quotes: 8 per locale + stable per certificate no + locale split", () => {
  assert.equal(SOUL_QUOTES_ZH.length, 8);
  assert.equal(SOUL_QUOTES_EN.length, 8);
  const a = soulQuoteFor("AIBI-000456", "zh");
  assert.ok(SOUL_QUOTES_ZH.includes(a), "zh pool");
  assert.equal(soulQuoteFor("AIBI-000456", "zh"), a, "stable across calls");
  assert.ok(SOUL_QUOTES_EN.includes(soulQuoteFor("AIBI-000456", "en")), "en pool");
});

// === 2) share.png 增强 ===
test("share.png: stage badge + quote + site-derived watermark", () => {
  const c = read("src/app/api/soul-cards/[id]/share.png/route.tsx");
  assert.ok(c.includes("STAGE_BADGE"), "stage badge map");
  for (const s of ["seed", "sprout", "bloom", "radiant"]) {
    assert.ok(c.includes(`${s}:`), `badge color for ${s}`);
  }
  assert.ok(c.includes("soulQuoteFor(String(card.certificateNo)"), "quote by cert no");
  assert.ok(c.includes("new URL(SITE_URL).host"), "watermark from SITE_URL");
  assert.ok(!c.includes("aiabw.com\n"), "no hardcoded domain");
  assert.ok(c.includes("certificateNo"), "certificate number kept");
});

// === 3) SoulCardStory 分享按钮 ===
test("soul-card-story: share button with navigator.share + download fallback", () => {
  const s = read("src/components/soul-card/soul-card-story.tsx");
  assert.ok(s.includes('fetch("/api/soul-cards/') || s.includes("fetch(pngUrl)"), "fetch share.png");
  assert.ok(s.includes("navigator.canShare?.({ files: [file] })"), "canShare files check");
  assert.ok(s.includes("await navigator.share({ files: [file], text"), "share with text");
  assert.ok(s.includes('t("share.text"'), "prefilled share text i18n");
  assert.ok(s.includes("/soul-cards/${card.id}/public"), "public page link in text");
  assert.ok(s.includes("a.download = file.name"), "download fallback");
  assert.ok(s.includes('window.open(pngUrl, "_blank"'), "last-resort open");
  assert.ok(s.includes("sharing"), "busy state");
});

// === 4) /soul-cards/[id]/public 公开页 ===
test("public page: noindex + active-only + readonly card + register CTA", () => {
  const p = read("src/app/[locale]/soul-cards/[id]/public/page.tsx");
  assert.ok(p.includes("robots: { index: false, follow: false }"), "noindex");
  assert.ok(p.includes('card.status === "active"'), "active only");
  assert.ok(p.includes("notFound()"), "404 for missing/burned");
  assert.ok(p.includes("<SoulCardView card={toDto(card)} locale={locale} />"), "readonly card view");
  assert.ok(!p.includes("onClick="), "no interactions passed");
  assert.ok(p.includes('href="/register"'), "awaken CTA → register");
  assert.ok(p.includes("soulQuoteFor(card.certificateNo, locale)"), "quote rendered");
  assert.ok(p.includes("findSoulCardById"), "repository reuse");
});

// === 5) i18n（zh/en 对齐） ===
test("soul-card share i18n: share.text params + public keys aligned zh/en", () => {
  for (const dict of [zh, en]) {
    const share = dict.soulCards?.share;
    assert.ok(share.text, "share.text");
    for (const k of ["no", "stage", "url"]) {
      assert.ok(share.text.includes(`{${k}}`), `share.text param {${k}}`);
    }
    assert.ok(share.sharing, "share.sharing");
    const pub = dict.soulCards?.public;
    for (const k of ["badge", "cta", "hint"]) {
      assert.ok(pub[k], `soulCards.public.${k}`);
    }
  }
});
