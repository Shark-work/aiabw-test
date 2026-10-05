/**
 * 契约测试：产品升级 Phase 3 —— 探索奖励强化（2026-10-16）
 * 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/exploration-rewards.test.mjs
 *
 * 覆盖：
 *  纯函数：computeStreak（今天起/昨天起/断档/空）+ computeRewards（基础分/VIP 倍率/
 *          连探加成封顶/里程碑/碎片与道具概率/随机调用顺序/总分合成）
 *  契约：start 路由事务化发放（points_log ref 幂等 + user_items 道具/碎片 + 降级）
 *        quota streak 返回 / history 筛选+stats / engine 响应类型 /
 *        前端报告卡+连探进度条+筛选统计 / globals keyframes / i18n 双语对齐
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  EXPLORATION_REWARD_CONFIG,
  computeStreak,
  computeRewards,
} from "../src/lib/exploration-rewards.ts";
import { CHECKIN_ITEMS } from "../src/lib/checkin-items.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** 生成按序列返回的伪随机源（耗尽后返回 last） */
function seq(values, last = 0.99) {
  let i = 0;
  const fn = () => (i < values.length ? values[i++] : last);
  fn.calls = () => i;
  return fn;
}

function dayOffset(base, n) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = "2026-10-16";

// ───────────── 1) computeStreak ─────────────

test("computeStreak: 空历史 / 仅今天 / 连续多天 / 断档 / 昨天起（quota 场景）/ 前天起归零", () => {
  assert.equal(computeStreak([], TODAY), 0, "empty → 0");
  assert.equal(computeStreak([TODAY], TODAY), 1, "today only → 1");
  assert.equal(
    computeStreak([TODAY, dayOffset(TODAY, 1), dayOffset(TODAY, 2)], TODAY),
    3,
    "today+2 consecutive → 3",
  );
  assert.equal(
    computeStreak([TODAY, dayOffset(TODAY, 2)], TODAY),
    1,
    "gap breaks streak → 1",
  );
  assert.equal(
    computeStreak([dayOffset(TODAY, 1), dayOffset(TODAY, 2), dayOffset(TODAY, 3)], TODAY),
    3,
    "today not yet explored, unbroken from yesterday → 3",
  );
  assert.equal(
    computeStreak([dayOffset(TODAY, 2)], TODAY),
    0,
    "last exploration 2 days ago → broken → 0",
  );
  assert.equal(computeStreak(null, TODAY), 0, "null safe");
});

// ───────────── 2) 基础分与 VIP 倍率 ─────────────

test("computeRewards: 基础分 common2/rare5/epic10，VIP ×1.5 向下取整", () => {
  const base = { streak: 1, totalCount: 1, random: seq([], 0.99) };
  assert.equal(computeRewards({ rarity: "common", isVip: false, ...base }).basePoints, 2);
  assert.equal(computeRewards({ rarity: "rare", isVip: false, ...base }).basePoints, 5);
  assert.equal(computeRewards({ rarity: "epic", isVip: false, ...base }).basePoints, 10);
  assert.equal(computeRewards({ rarity: "common", isVip: true, ...base }).basePoints, 3);
  assert.equal(computeRewards({ rarity: "rare", isVip: true, ...base }).basePoints, 7);
  assert.equal(computeRewards({ rarity: "epic", isVip: true, ...base }).basePoints, 15);
});


// ───────────── 3) 连探加成（第 2 天起 +1，封顶 +5）─────────────

test("computeRewards: 连探加成 min(streak-1, 5)", () => {
  const at = (streak) =>
    computeRewards({ rarity: "common", isVip: false, streak, totalCount: 1, random: seq([], 0.99) });
  assert.equal(at(0).streakBonus, 0);
  assert.equal(at(1).streakBonus, 0, "day1 no bonus");
  assert.equal(at(2).streakBonus, 1);
  assert.equal(at(3).streakBonus, 2);
  assert.equal(at(6).streakBonus, 5, "cap at +5");
  assert.equal(at(30).streakBonus, 5, "still capped");
  assert.equal(EXPLORATION_REWARD_CONFIG.STREAK_BONUS_CAP, 5);
});

// ───────────── 4) 里程碑（每 10 次：+10 分 +1 碎片）─────────────

test("computeRewards: 每 10 次里程碑（9 无 / 10 触发 / 20 触发 / 0 安全）", () => {
  const at = (totalCount) =>
    computeRewards({ rarity: "common", isVip: false, streak: 1, totalCount, random: seq([], 0.99) });
  assert.equal(at(9).milestone, null);
  assert.equal(at(9).milestonePoints, 0);
  const m10 = at(10);
  assert.equal(m10.milestone, 10);
  assert.equal(m10.milestonePoints, EXPLORATION_REWARD_CONFIG.MILESTONE_POINTS);
  assert.equal(m10.fragments, EXPLORATION_REWARD_CONFIG.MILESTONE_FRAGMENTS, "milestone grants fragment");
  assert.equal(at(20).milestone, 20);
  assert.equal(at(0).milestone, null, "totalCount=0 safe");
  assert.equal(EXPLORATION_REWARD_CONFIG.MILESTONE_INTERVAL, 10);
});


// ───────────── 5) 碎片 / 道具概率与随机调用顺序 ─────────────

test("computeRewards: 碎片 common 不掉 / rare 20% / epic 必掉；道具 common 不掉 / epic 必掉且来自签到池", () => {
  // common：两次 roll（碎片判定 + 道具判定）都不中
  const c = computeRewards({ rarity: "common", isVip: false, streak: 1, totalCount: 1, random: seq([0.99, 0.99]) });
  assert.equal(c.fragments, 0);
  assert.equal(c.items.length, 0);

  // rare：碎片 roll 0.1 < 0.2 中；道具 roll 0.99 不中
  const r = computeRewards({ rarity: "rare", isVip: false, streak: 1, totalCount: 1, random: seq([0.1, 0.99]) });
  assert.equal(r.fragments, 1);
  assert.equal(r.items.length, 0);

  // rare：碎片 roll 0.5 不中；道具 roll 0.1 < 0.3 中 → rollCheckinItem 再消耗 2 次随机
  const r2 = computeRewards({ rarity: "rare", isVip: false, streak: 1, totalCount: 1, random: seq([0.5, 0.1, 0.0, 0.0]) });
  assert.equal(r2.fragments, 0);
  assert.equal(r2.items.length, 1);
  assert.ok(CHECKIN_ITEMS.some((i) => i.key === r2.items[0].key), "item from checkin pool");

  // epic：碎片必掉（roll 任意 < 1）；道具必掉；共 4 次随机调用（顺序固定）
  const rand = seq([0.99, 0.99, 0.99, 0.99]);
  const e = computeRewards({ rarity: "epic", isVip: false, streak: 1, totalCount: 3, random: rand });
  assert.equal(e.fragments, 1, "epic fragment guaranteed");
  assert.equal(e.items.length, 1, "epic item guaranteed");
  assert.equal(rand.calls(), 4, "rand call order fixed: fragment → item-roll → rarity-roll → pick");
});

// ───────────── 6) 总分合成 ─────────────

test("computeRewards: points = base + streak + milestone（VIP epic streak8 第 20 次）", () => {
  const r = computeRewards({
    rarity: "epic",
    isVip: true,
    streak: 8,
    totalCount: 20,
    random: seq([0.99, 0.99, 0.5, 0.5]),
  });
  assert.equal(r.basePoints, 15);
  assert.equal(r.streakBonus, 5);
  assert.equal(r.milestonePoints, 10);
  assert.equal(r.points, 30, "15+5+10");
  assert.equal(r.milestone, 20);
  assert.equal(r.streak, 8);
  // epic 碎片 100% 必中（0.99 < 1）+ 里程碑追加 1 → 共 2
  assert.equal(r.fragments, 2);
});

// ───────────── 7) start 路由契约：事务化发放 + 幂等 + 降级 ─────────────

test("start route: 奖励事务（BEGIN/COMMIT/ROLLBACK）+ points_log ref 幂等 + user_items 道具/碎片 + 失败降级", () => {
  const src = read("src/app/api/exploration/start/route.ts");
  assert.ok(src.includes('from "@/lib/exploration-rewards"'), "imports rewards engine");
  assert.ok(src.includes("computeRewards(") && src.includes("computeStreak("), "uses pure functions");
  assert.ok(src.includes('"BEGIN"') && src.includes('"COMMIT"') && src.includes('"ROLLBACK"'), "tx wrap");
  assert.ok(src.includes("UPDATE users SET points = points + $2 WHERE id = $1"), "points credit");
  assert.ok(src.includes("INSERT INTO points_log"), "points_log audit");
  assert.ok(src.includes("`explore:${recordId}`"), "idempotency ref = explore:<recordId>");
  assert.ok(src.includes("EXPLORATION_REWARD_CONFIG.POINTS_REASON"), "reason from config");
  const itemInserts = src.match(/INSERT INTO user_items/g) ?? [];
  assert.ok(itemInserts.length >= 2, "items + fragments both into user_items");
  assert.ok(src.includes("EXPLORATION_REWARD_CONFIG.FRAGMENT_ITEM_KEY"), "fragment key from config");
  assert.ok(src.includes("rewards: rewardsPayload"), "response carries rewards");
  assert.ok(
    src.includes("[/api/exploration/start] rewards grant failed:"),
    "grant failure degrades without blocking main flow",
  );
  assert.ok(src.includes("itemDisplayName(it, locale)"), "item name localized server-side");
});

// ───────────── 8) quota / history 路由契约 ─────────────

test("quota route: streak 由记录表实时推导并返回", () => {
  const src = read("src/app/api/exploration/quota/route.ts");
  assert.ok(src.includes("computeStreak"), "uses computeStreak");
  assert.ok(src.includes("to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"), "UTC day grouping");
  assert.ok(src.includes("streak });"), "response carries streak");
});

test("history route: type/rare 筛选 + 全量 stats 聚合 + filter 回显", () => {
  const src = read("src/app/api/exploration/history/route.ts");
  assert.ok(src.includes("EVENT_TYPES.includes"), "type validated against EVENT_TYPES");
  assert.ok(src.includes('url.searchParams.get("rare") === "1"'), "rare=1 filter");
  assert.ok(src.includes("eq(explorationRecords.isRare, true)"), "is_rare condition");
  assert.ok(src.includes("count(*) FILTER (WHERE is_rare)"), "stats rareCount");
  assert.ok(src.includes('coalesce(sum(steps_gained), 0)::int AS "totalSteps"'), "stats totalSteps");
  assert.ok(src.includes("round(sum(distance_gained)::numeric, 2)"), "stats totalDistance");
  assert.ok(src.includes("stats,"), "response carries stats");
  assert.ok(src.includes("filter: { type: typeFilter, rareOnly }"), "filter echo");
});

// ───────────── 9) engine 响应类型契约 ─────────────

test("engine: ExplorationStartResponse 扩展 rewards 字段（type-only import 无循环依赖）", () => {
  const src = read("src/lib/exploration-engine.ts");
  assert.ok(
    src.includes('rewards?: import("./exploration-rewards").ExplorationRewardsPayload | null'),
    "rewards field on response type",
  );
  const rewardsSrc = read("src/lib/exploration-rewards.ts");
  assert.ok(
    rewardsSrc.includes('import type { Rarity } from "@/lib/exploration-engine"'),
    "type-only rarity import (no runtime cycle)",
  );
});

// ───────────── 10) 前端契约：报告卡 / 进度条 / 筛选统计 ─────────────

test("explore-button: rewards 透传（payload 类型 + fetch 类型 + onResult）", () => {
  const src = read("src/components/exploration-v2/explore-button.tsx");
  assert.ok(src.includes('import type { ExplorationRewardsPayload } from "@/lib/exploration-rewards"'), "type import");
  assert.ok(src.includes("rewards?: ExplorationRewardsPayload | null;"), "payload field");
  assert.ok(src.includes("rewards: data.rewards ?? null,"), "onResult passthrough");
});

test("explore-result-modal: 探索报告卡（积分分解/道具/碎片/连探/里程碑 + 逐项弹入动画）", () => {
  const src = read("src/components/exploration-v2/explore-result-modal.tsx");
  for (const id of [
    "explore-result-rewards",
    "explore-reward-points",
    "explore-reward-item",
    "explore-reward-fragments",
    "explore-reward-streak",
    "explore-reward-milestone",
  ]) {
    assert.ok(src.includes(`data-testid="${id}"`), `modal has ${id}`);
  }
  assert.ok(src.includes("ex-reward-in"), "staggered entry animation referenced");
  assert.ok(src.includes('t("rewards.reportTitle")'), "report title");
  assert.ok(src.includes('t("rewards.points", { n: result.rewards.points })'), "points line");
  assert.ok(src.includes("result.rewards && ("), "rewards=null degraded (no render)");
});

test("explore-v2-panel: 连探进度条 + 历史筛选 chips + 统计条 + 探索后 streak 联动", () => {
  const src = read("src/components/exploration-v2/explore-v2-panel.tsx");
  for (const id of [
    "explore-streak-bar",
    "explore-streak-bonus",
    "explore-streak-progress",
    "explore-history-stats",
    "explore-history-filters",
  ]) {
    assert.ok(src.includes(`data-testid="${id}"`), `panel has ${id}`);
  }
  // 筛选 chips 为模板 testid（explore-filter-<key>，覆盖 all/rare 等 7 项）
  assert.ok(src.includes("data-testid={`explore-filter-${f.key}`}"), "filter chip template testid");
  const chipKeys = [...src.matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(chipKeys, ["all", "postcard", "gift", "knowledge", "encounter", "rest", "rare"], "HISTORY_FILTERS keys");
  assert.ok(src.includes("EXPLORATION_REWARD_CONFIG.STREAK_BONUS_CAP"), "bonus cap shared with backend config");
  assert.ok(src.includes('params.set("type", filter.type)') && src.includes('params.set("rare", "1")'), "filter query params");
  assert.ok(src.includes("applyHistoryFilter"), "filter switch handler");
  assert.ok(src.includes("setStreak(payload.rewards.streak)"), "streak refreshed after exploration");
  assert.ok(src.includes("rewards: payload.rewards ?? null,"), "rewards into modal data");
});

// ───────────── 11) CSS keyframes ─────────────

test("globals.css: ex-reward-in keyframes（报告卡逐项入场）", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes("@keyframes ex-reward-in"), "keyframes defined");
});

// ───────────── 12) i18n 双语对齐 ─────────────

test("i18n: explorationV2.rewards/streak/history 双语对齐（filters 7 项 + 占位符对齐）", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const sub of ["rewards", "streak", "history"]) {
    assert.ok(zh.explorationV2[sub], `zh explorationV2.${sub}`);
    assert.ok(en.explorationV2[sub], `en explorationV2.${sub}`);
    assert.deepEqual(
      Object.keys(zh.explorationV2[sub]).sort(),
      Object.keys(en.explorationV2[sub]).sort(),
      `${sub} key parity`,
    );
  }
  const fzh = Object.keys(zh.explorationV2.history.filters).sort();
  const fen = Object.keys(en.explorationV2.history.filters).sort();
  assert.deepEqual(fzh, ["all", "encounter", "gift", "knowledge", "postcard", "rare", "rest"]);
  assert.deepEqual(fzh, fen, "filters parity");
  const ph = (s) => (String(s).match(/\{[^}]+\}/g) ?? []).sort().join(",");
  for (const sub of ["rewards", "streak"]) {
    for (const [k, v] of Object.entries(zh.explorationV2[sub])) {
      assert.equal(ph(v), ph(en.explorationV2[sub][k]), `${sub}.${k} placeholder parity`);
    }
  }
  assert.equal(ph(zh.explorationV2.history.statsLine), ph(en.explorationV2.history.statsLine), "statsLine placeholders");
});

// ───────────── 13) 零 schema 变更红线 ─────────────

test("Phase 3 红线：碎片/道具复用 user_items + 实时推导，无新表无 SCHEMA bump", () => {
  const client = read("src/db/client.ts");
  assert.ok(!client.includes("soul_fragment"), "no fragment column/table in schema sync");
  const rewardsSrc = read("src/lib/exploration-rewards.ts");
  assert.equal(EXPLORATION_REWARD_CONFIG.FRAGMENT_ITEM_KEY, "soul_fragment");
  assert.equal(EXPLORATION_REWARD_CONFIG.REWARD_SOURCE, "exploration");
  assert.ok(rewardsSrc.includes("user_items"), "documented: fragments live in user_items");
  assert.ok(existsSync(join(ROOT, "src/lib/exploration-rewards.ts")), "engine file exists");
});
