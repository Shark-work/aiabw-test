// 宠物旅行日记 · 探索配置单测
// 注意：本文件是 .mjs（CommonJS-like ESM），通过 tsx/Node 22+ 的 type stripping 直接跑 TS 源。
// 项目其它测试用 `import ... from "../src/lib/xxx.ts"` 这种模式（见 tests/agent-embedding.test.mjs）。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPLORATION_MAPS,
  EXPLORATION_ITEMS,
  MAP_EVENT_SEEDS,
  STEPS_PER_MAP,
  STEPS_PER_MESSAGE,
  EVENT_BASE_PROBABILITY,
  TOTAL_STEPS,
  advanceStep,
  fillItemPlaceholder,
  pickEventForMap,
  progressToRatio,
  rollEventCheckInterval,
  shouldTriggerEvent,
} from "../src/lib/exploration-config.ts";

test("exploration: 7 maps × 100 steps = 700 total", () => {
  assert.equal(EXPLORATION_MAPS.length, 7);
  assert.equal(STEPS_PER_MAP, 100);
  assert.equal(TOTAL_STEPS, 700);
  assert.equal(STEPS_PER_MESSAGE, 10);
  // 事件基础概率 60%（业务规则）
  assert.equal(EVENT_BASE_PROBABILITY, 0.6);
});

test("exploration: 6 unique items, all have key+emoji+rarity", () => {
  assert.equal(EXPLORATION_ITEMS.length, 6);
  const keys = new Set(EXPLORATION_ITEMS.map((i) => i.key));
  assert.equal(keys.size, 6, "duplicate item keys");
  for (const it of EXPLORATION_ITEMS) {
    assert.ok(it.emoji.length > 0, `item ${it.key} missing emoji`);
    assert.ok(["common", "rare", "epic", "legendary"].includes(it.rarity));
  }
});

test("exploration: 21 event seeds = 7 maps × 3 events", () => {
  assert.equal(MAP_EVENT_SEEDS.length, 21);
  for (let m = 1; m <= 7; m++) {
    const events = MAP_EVENT_SEEDS.filter((e) => e.mapId === m);
    assert.equal(events.length, 3, `map ${m} should have 3 events`);
  }
});

test("exploration: advanceStep wraps to next map when progress hits 100", () => {
  const r1 = advanceStep({ currentMapId: 1, mapProgress: 99 });
  assert.equal(r1.currentMapId, 1);
  assert.equal(r1.mapProgress, 100);
  assert.equal(r1.completedMapId, undefined);

  const r2 = advanceStep({ currentMapId: 1, mapProgress: 100 });
  assert.equal(r2.currentMapId, 2, "should advance to map 2");
  assert.equal(r2.mapProgress, 0);
  assert.equal(r2.completedMapId, 1, "should report completed map id");

  // 最后一段完成后回到 1
  const r3 = advanceStep({ currentMapId: 7, mapProgress: 100 });
  assert.equal(r3.currentMapId, 1, "after final map, cycle to 1");
  assert.equal(r3.completedMapId, 7);
});

test("exploration: rollEventCheckInterval returns 15..25 inclusive", () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const n = rollEventCheckInterval(r);
    assert.ok(n >= 15 && n <= 25, `interval ${n} out of range for r=${r}`);
  }
});

test("exploration: shouldTriggerEvent base probability ~60%", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    if (shouldTriggerEvent(Math.random(), "sunny")) hits++;
  }
  // 期望 ~60%，允许 ±10% 浮动
  assert.ok(hits > 480 && hits < 720, `trigger rate ${hits}/1000 unexpected`);
});

test("exploration: weather bias boosts trigger probability", () => {
  // r 刚好在基础概率边缘 (0.65)：基础情况下不触发，但 rainy 命中应触发
  const r = 0.65;
  const baseTrig = shouldTriggerEvent(r, "sunny", null);
  const biasTrig = shouldTriggerEvent(r, "rainy", "rainy");
  assert.equal(baseTrig, false, "base 0.65 > 0.6 should NOT trigger");
  assert.equal(biasTrig, true, "rainy bias should boost to 0.8, 0.65 < 0.8 triggers");
});

test("exploration: pickEventForMap returns null for empty map id", () => {
  const e = pickEventForMap(999, 0.5, "sunny");
  assert.equal(e, null);
});

test("exploration: pickEventForMap with r=0 returns first event of map", () => {
  // r=0 → pool[0] 选第一项；r=0 < 0.6 基础概率 → 触发
  const e = pickEventForMap(1, 0, "sunny");
  assert.ok(e !== null, "should pick something for map 1 with r=0");
  assert.equal(e?.mapId, 1);
});

test("exploration: pickEventForMap with r>0.99 skips trigger (60% base)", () => {
  // r=0.99 → pool[2] (第三项) ，0.99 > 0.6 → 不触发
  const e = pickEventForMap(1, 0.99, "sunny");
  assert.equal(e, null);
});

test("exploration: progressToRatio clamps to [0,1]", () => {
  assert.equal(progressToRatio(0), 0);
  assert.equal(progressToRatio(50), 0.5);
  assert.equal(progressToRatio(100), 1);
  assert.equal(progressToRatio(-5), 0);
  assert.equal(progressToRatio(150), 1);
});

test("exploration: fillItemPlaceholder substitutes {item}", () => {
  const tpl = "你获得了【{item}】！";
  const out = fillItemPlaceholder(tpl, "feather", "zh");
  assert.ok(out.includes("神秘羽毛"), `expected "神秘羽毛" in "${out}"`);
  assert.ok(!out.includes("{item}"), "should not leave placeholder");
  // unknown key 保留原模板
  const out2 = fillItemPlaceholder(tpl, "nope", "zh");
  assert.equal(out2, tpl);
  // null 也保留
  const out3 = fillItemPlaceholder(tpl, null, "zh");
  assert.equal(out3, tpl);
});

test("exploration: fillItemPlaceholder respects locale", () => {
  const tpl = "Got {item}!";
  const out = fillItemPlaceholder(tpl, "compass", "en");
  assert.ok(out.includes("Compass"));
});

test("exploration: every map has defaultWeather in valid set", () => {
  const valid = new Set(["sunny", "rainy", "snowy", "cloudy"]);
  for (const m of EXPLORATION_MAPS) {
    assert.ok(valid.has(m.defaultWeather), `map ${m.id} invalid weather ${m.defaultWeather}`);
  }
});
