/**
 * P1 故事外显 · 灵魂卡成长卡面契约测试（2026-10-14，改动二）
 *
 * 覆盖（验收口径：四档卡面可区分 + 阶段 EXP 进度 + 探索履历数据 + 分享图）：
 *  1) stageProgress 纯函数：阶段区间口径（seed/sprout/bloom/radiant 边界与中段）；
 *  2) SoulCardView 四档视觉：STAGE_FX 映射 + 沉睡标注 + radiant 光晕 + burned 优先；
 *  3) SoulCardGrowth：阶段进度行（toNextStage / stageMax）；
 *  4) GET /api/soul-cards/[id]/story：401 / 非本人 404 同口径 + 探索聚合 + adoption 关联；
 *  5) SoulCardStory 阶段门控 + 分享按钮；
 *  6) share.png：ImageResponse 600×1000 + 公开读 active 卡 + CJK 字体复用；
 *  7) i18n 新 key（zh/en 对齐）。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { stageProgress } from "../src/lib/soul-card-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) stageProgress 纯函数 ===
test("stageProgress: stage-interval EXP accounting", () => {
  // seed 起点：Lv.1 exp 0 → 距 sprout（Lv.10）总需 Σ(1..9)×100 = 4500
  const seed0 = stageProgress(1, 0);
  assert.equal(seed0.current.id, "seed");
  assert.equal(seed0.next?.id, "sprout");
  assert.equal(seed0.expRemaining, 4500);
  assert.equal(seed0.percent, 0);
  // seed 中段：Lv.5 exp 50 → done = (1+2+3+4)×100 + 50 = 1050
  const seedMid = stageProgress(5, 50);
  assert.equal(seedMid.expRemaining, 4500 - 1050);
  assert.equal(seedMid.percent, Math.round((1050 / 4500) * 100));
  // sprout 起点：Lv.10 exp 0 → 距 bloom（Lv.30）总需 Σ(10..29)×100
  const sprout0 = stageProgress(10, 0);
  assert.equal(sprout0.current.id, "sprout");
  assert.equal(sprout0.next?.id, "bloom");
  let expectTotal = 0;
  for (let l = 10; l < 30; l += 1) expectTotal += l * 100;
  assert.equal(sprout0.expRemaining, expectTotal);
  // radiant：终点（next=null，percent 恒 100，含未满级 Lv.60-98）
  const radiant = stageProgress(60, 0);
  assert.equal(radiant.current.id, "radiant");
  assert.equal(radiant.next, null);
  assert.equal(radiant.percent, 100);
  assert.equal(radiant.expRemaining, 0);
  const max = stageProgress(99, 0);
  assert.equal(max.percent, 100);
});

// === 2) SoulCardView 四档视觉 ===
test("soul-card-view: 4-stage visual mapping + sleeping/radiant marks + burned precedence", () => {
  const v = read("src/components/soul-card/soul-card-view.tsx");
  assert.ok(v.includes("STAGE_FX"), "stage visual map");
  for (const s of ["seed", "sprout", "bloom", "radiant"]) {
    assert.ok(new RegExp(`${s}: \\{`).test(v), `STAGE_FX.${s}`);
  }
  assert.ok(v.includes("opacity-75 grayscale"), "seed grayscale img");
  assert.ok(v.includes("💤"), "seed 💤 mark");
  assert.ok(v.includes('t("sleeping")'), "sleeping chip beside certificate no");
  assert.ok(v.includes("ring-emerald-300/70"), "sprout green ring");
  assert.ok(v.includes("from-violet-50 to-rose-50"), "bloom colorful panel");
  assert.ok(v.includes("shadow-[0_0_28px_rgba(251,191,36,0.45)]"), "radiant glow");
  assert.ok(v.includes("✨"), "radiant ✨ mark");
  assert.ok(v.includes('burned ? "opacity-40 grayscale" : fx.img'), "burned overrides stage fx");
  assert.ok(v.includes('burned ? "" : fx.glow'), "burned suppresses glow");
});

// === 3) SoulCardGrowth 阶段进度行 ===
test("soul-card-growth: stage progress line wired", () => {
  const g = read("src/components/soul-card/soul-card-growth.tsx");
  assert.ok(g.includes("stageProgress(level, exp)"), "stageProgress call");
  assert.ok(g.includes('t("toNextStage"'), "toNextStage i18n");
  assert.ok(g.includes('t("stageMax")'), "stageMax i18n");
  assert.ok(g.includes("sp.percent"), "percent rendered");
});

// === 4) GET /api/soul-cards/[id]/story ===
test("story api: owner-only (404 for non-owner) + exploration aggregation + adoption join", () => {
  const c = read("src/app/api/soul-cards/[id]/story/route.ts");
  assert.ok(c.includes("getUserFromRequest(req)"), "bearer auth");
  assert.ok(c.includes("{ status: 401 }"), "unauthenticated 401");
  assert.ok(
    c.includes("if (!card || card.ownerId !== user.id)"),
    "non-owner → 404 (existence not leaked)",
  );
  assert.ok(c.includes("FROM exploration_records"), "exploration source");
  assert.ok(c.includes("result_type = 'postcard'"), "postcard count");
  assert.ok(c.includes("result_type = 'gift'"), "gift count");
  assert.ok(c.includes("is_rare"), "rare encounter count");
  assert.ok(
    c.includes("JOIN adoptions a ON a.id = uc.adoption_id"),
    "happiness via user_collectibles → adoptions",
  );
  assert.ok(c.includes("mintedAt"), "awaken date for milestone");
});

// === 5) SoulCardStory 阶段门控 + 分享按钮 + detail-modal 挂载 ===
test("soul-card-story: stage-gated content + share button + modal wiring", () => {
  const s = read("src/components/soul-card/soul-card-story.tsx");
  assert.ok(s.includes("fetch(`/api/soul-cards/${card.id}/story`"), "story data source");
  assert.ok(s.includes('stage.id === "seed"'), "seed gate");
  assert.ok(s.includes('t("story.sleepingHint")'), "seed hint");
  assert.ok(s.includes('t("story.milestoneSprout")'), "sprout milestone");
  assert.ok(s.includes('t("story.exploreSummary"'), "bloom explore summary");
  assert.ok(s.includes('t("story.statsHappiness"'), "radiant full stats incl. happiness");
  assert.ok(s.includes('t("story.rareMark")'), "radiant rare mark");
  // P2 社交传播：分享按钮由 <a target=_blank> 升级为系统分享/下载（详见 soul-card-share.test）
  assert.ok(
    s.includes('const pngUrl = `/api/soul-cards/${card.id}/share.png`'),
    "share button → share.png",
  );
  const m = read("src/components/soul-card/soul-card-detail-modal.tsx");
  assert.ok(m.includes('import { SoulCardStory } from "./soul-card-story"'), "import");
  assert.ok(m.includes("<SoulCardStory card={card} locale={locale} />"), "mounted");
});

// === 6) share.png 路由 ===
test("share.png: ImageResponse 600x1000, public active card, CJK font reuse", () => {
  const p = "src/app/api/soul-cards/[id]/share.png/route.tsx";
  assert.ok(exists(p), "route exists");
  const c = read(p);
  assert.ok(c.includes('from "next/og"'), "next/og");
  assert.ok(c.includes("new ImageResponse("), "ImageResponse render");
  assert.ok(c.includes("width: 600"), "600 wide");
  assert.ok(c.includes("height: 1000"), "1000 tall");
  assert.ok(c.includes("loadCjkFont"), "CJK font reuse (og-share-image)");
  assert.ok(c.includes("sc.status = 'active'"), "burned cards 404");
  assert.ok(c.includes("RARITY_GRADIENT"), "rarity gradient background");
  assert.ok(c.includes("certificateNo"), "certificate number on image");
  const og = read("src/lib/og-share-image.tsx");
  assert.ok(og.includes("export async function loadCjkFont"), "loadCjkFont exported");
});

// === 7) i18n 新 key（zh/en 对齐） ===
test("soul card story i18n: new keys aligned zh/en", () => {
  for (const dict of [zh, en]) {
    const sc = dict.soulCards;
    for (const k of ["toNextStage", "stageMax", "sleeping", "radiantMark"]) {
      assert.ok(sc[k], `soulCards.${k}`);
    }
    for (const k of [
      "title",
      "sleepingHint",
      "milestoneSprout",
      "exploreSummary",
      "statsExplorations",
      "statsPostcards",
      "statsGifts",
      "statsKnowledge",
      "statsRare",
      "statsHappiness",
      "rareMark",
    ]) {
      assert.ok(sc.story[k], `soulCards.story.${k}`);
    }
    assert.ok(sc.share.button, "soulCards.share.button");
    assert.ok(
      sc.toNextStage.includes("{stage}") && sc.toNextStage.includes("{exp}"),
      "toNextStage params",
    );
    assert.ok(
      sc.story.exploreSummary.includes("{count}") &&
        sc.story.exploreSummary.includes("{postcards}"),
      "exploreSummary params",
    );
  }
});

