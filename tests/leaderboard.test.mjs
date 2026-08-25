import { test } from "node:test";
import assert from "node:assert/strict";
import {
  petPower,
  startOfWeek,
  RARITY_POWER,
  ELEMENT_BONUS,
} from "../src/lib/leaderboard.ts";

test("leaderboard: rarity power weights", () => {
  assert.equal(RARITY_POWER.common, 10);
  assert.equal(RARITY_POWER.uncommon, 30);
  assert.equal(RARITY_POWER.rare, 100);
  assert.equal(RARITY_POWER.epic, 300);
  assert.equal(RARITY_POWER.legendary, 1000);
});

test("leaderboard: power = rarity weight * 10^(gen-1) + element bonus", () => {
  // common 1 代 无元素
  assert.equal(petPower(1, "common", null), 10);
  // legendary 1 代 fire
  assert.equal(petPower(1, "legendary", "fire"), 1000 + ELEMENT_BONUS.fire);
  // rare 2 代 earth
  assert.equal(petPower(2, "rare", "earth"), 100 * 10 + ELEMENT_BONUS.earth);
  // epic 3 代 water
  assert.equal(petPower(3, "epic", "water"), 300 * 100 + ELEMENT_BONUS.water);
});

test("leaderboard: higher generation dominates", () => {
  // legendary 1 代 战力 1005；rare 4 代 战力 100*1000+3 >> legendary
  assert.ok(petPower(4, "rare", "earth") > petPower(1, "legendary", "fire"));
});

test("leaderboard: unknown rarity falls back to common", () => {
  assert.equal(petPower(1, "whatever", null), 10);
  assert.equal(petPower(1, undefined, null), 10);
});

test("leaderboard: startOfWeek returns Monday 00:00", () => {
  // 2026-08-25 是周二（本地），本周一 = 2026-08-24
  const monday = startOfWeek(new Date(2026, 7, 25, 15, 30, 0));
  assert.equal(monday.getDay(), 1, "周一");
  assert.equal(monday.getDate(), 24);
  assert.equal(monday.getHours(), 0);
  // 周日（2026-08-23）是上一周最后一天 → 周一起点 2026-08-17
  const sundayWeek = startOfWeek(new Date(2026, 7, 23, 10, 0, 0));
  assert.equal(sundayWeek.getDay(), 1);
  assert.equal(sundayWeek.getDate(), 17);
});
