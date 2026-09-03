import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKIN_ITEMS,
  MOOD_EXPRESSIONS,
  RARITY_BADGE_CLASS,
  RARITY_WEIGHTS,
  itemByKey,
  itemDisplayName,
  moodKeyFor,
  rollCheckinItem,
} from "../src/lib/checkin-items.ts";

test("checkin-items: catalog has 3 categories × 3 rarities with unique keys", () => {
  assert.equal(CHECKIN_ITEMS.length, 9);
  const keys = new Set(CHECKIN_ITEMS.map((i) => i.key));
  assert.equal(keys.size, 9, "keys must be unique");
  for (const category of ["hat", "scarf", "toy"]) {
    assert.equal(CHECKIN_ITEMS.filter((i) => i.category === category).length, 3);
  }
  for (const rarity of ["common", "rare", "legendary"]) {
    assert.equal(CHECKIN_ITEMS.filter((i) => i.rarity === rarity).length, 3);
  }
  // 每件道具都有中英文名与 emoji
  for (const item of CHECKIN_ITEMS) {
    assert.ok(item.nameZh && item.nameEn && item.emoji);
  }
});

test("checkin-items: rarity weights are 70% / 25% / 5% (sum = 1)", () => {
  assert.equal(RARITY_WEIGHTS.common, 0.7);
  assert.equal(RARITY_WEIGHTS.rare, 0.25);
  assert.equal(RARITY_WEIGHTS.legendary, 0.05);
  assert.equal(
    RARITY_WEIGHTS.common + RARITY_WEIGHTS.rare + RARITY_WEIGHTS.legendary,
    1,
  );
});

test("checkin-items: roll boundaries deterministic (70 / 25 / 5)", () => {
  assert.equal(rollCheckinItem(0.0).rarity, "common");
  assert.equal(rollCheckinItem(0.69).rarity, "common");
  assert.equal(rollCheckinItem(0.7).rarity, "rare");
  assert.equal(rollCheckinItem(0.94).rarity, "rare");
  assert.equal(rollCheckinItem(0.95).rarity, "legendary");
  assert.equal(rollCheckinItem(0.999).rarity, "legendary");
});

test("checkin-items: guaranteedRare (月卡保底) never returns common", () => {
  assert.equal(rollCheckinItem(0.0, true).rarity, "rare");
  assert.equal(rollCheckinItem(0.69, true).rarity, "rare");
  for (let i = 0; i < 500; i++) {
    const item = rollCheckinItem(Math.random(), true);
    assert.notEqual(item.rarity, "common");
  }
});

test("checkin-items: roll always returns a catalog member with matching rarity", () => {
  for (let i = 0; i < 1000; i++) {
    const item = rollCheckinItem();
    const meta = itemByKey(item.key);
    assert.ok(meta, `unknown key: ${item.key}`);
    assert.equal(meta.rarity, item.rarity);
  }
});

test("checkin-items: pickRand selects within the rarity pool", () => {
  const a = rollCheckinItem(0.0, false, 0.0);
  const b = rollCheckinItem(0.0, false, 0.5);
  const c = rollCheckinItem(0.0, false, 0.99);
  assert.notEqual(a.key, b.key);
  assert.notEqual(b.key, c.key);
  assert.notEqual(a.key, c.key);
  assert.equal(a.rarity, "common");
});

test("checkin-items: itemByKey resolves known keys, undefined for unknown", () => {
  assert.equal(itemByKey("hat_crown")?.rarity, "legendary");
  assert.equal(itemByKey("not_exist"), undefined);
});

test("checkin-items: itemDisplayName by locale", () => {
  const crown = itemByKey("hat_crown");
  assert.equal(itemDisplayName(crown, "zh"), crown.nameZh);
  assert.equal(itemDisplayName(crown, "en"), crown.nameEn);
});

test("checkin-items: moodKeyFor streak tiers (1 / 3 / ≥7)", () => {
  assert.equal(moodKeyFor(1), "day1");
  assert.equal(moodKeyFor(2), "dayOther");
  assert.equal(moodKeyFor(3), "day3");
  assert.equal(moodKeyFor(4), "dayOther");
  assert.equal(moodKeyFor(6), "dayOther");
  assert.equal(moodKeyFor(7), "day7");
  assert.equal(moodKeyFor(14), "day7");
  assert.equal(moodKeyFor(100), "day7");
});

test("checkin-items: every mood/rarity has display meta", () => {
  for (const key of ["day1", "day3", "day7", "dayOther"]) {
    assert.ok(MOOD_EXPRESSIONS[key], `missing expression for ${key}`);
  }
  for (const rarity of ["common", "rare", "legendary"]) {
    assert.ok(RARITY_BADGE_CLASS[rarity], `missing badge class for ${rarity}`);
  }
});
