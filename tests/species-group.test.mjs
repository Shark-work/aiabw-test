// 图鉴物种去重（species-group）单元测试：
//  - 分组：同 speciesId 多实例 → 一张卡；rep = 稀有度最高记录；
//  - claimTarget：未拥有的最高稀有度实例；全领光 → null + allOwned；
//  - variantCount：组内 DISTINCT 稀有度种数（"共 X 种版本"）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RARITY_WEIGHT,
  distinctRarityCount,
  groupBySpecies,
  rarityWeight,
} from "../src/lib/species-group.ts";

/** @typedef {{ id: string; speciesId: string; name: string; traits: { rarity: string }; owned?: boolean }} Pet */

/** @type {(id: string, speciesId: string, rarity: string, owned?: boolean) => any} */
const pet = (id, speciesId, rarity, owned = false) => ({
  id,
  speciesId,
  name: speciesId,
  traits: { rarity },
  owned,
});

test("species-group: rarityWeight ordering legendary > epic > rare > uncommon > common", () => {
  assert.ok(rarityWeight("legendary") > rarityWeight("epic"));
  assert.ok(rarityWeight("epic") > rarityWeight("rare"));
  assert.ok(rarityWeight("rare") > rarityWeight("uncommon"));
  assert.ok(rarityWeight("uncommon") > rarityWeight("common"));
  assert.deepEqual(RARITY_WEIGHT, { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 });
});

test("species-group: rarityWeight fallback for unknown / missing rarity", () => {
  assert.equal(rarityWeight("mythic"), 0);
  assert.equal(rarityWeight(""), 0);
  assert.equal(rarityWeight(null), 0);
  assert.equal(rarityWeight(undefined), 0);
  // 未知稀有度排在已知稀有度之后（不丢数据）
  assert.ok(rarityWeight("common") > rarityWeight("mythic"));
});

test("species-group: dedupes same-species variants into one card with highest rarity rep", () => {
  const cards = groupBySpecies([
    pet("w1", "blue_whale", "common"),
    pet("w2", "blue_whale", "legendary"),
    pet("w3", "blue_whale", "epic"),
    pet("p1", "penguin", "uncommon"),
  ]);
  assert.equal(cards.length, 2, "蓝鲸 3 个实例 → 1 张卡 + 企鹅 1 张卡");
  const whale = cards.find((c) => c.speciesId === "blue_whale");
  assert.ok(whale, "应有蓝鲸卡");
  assert.equal(whale.rep.id, "w2", "rep 应为传说（最高稀有度）实例");
  assert.equal(whale.variants.length, 3);
  assert.deepEqual(
    whale.variants.map((v) => v.traits.rarity),
    ["legendary", "epic", "common"],
    "变体按稀有度降序",
  );
  assert.equal(whale.variantCount, 3, "蓝鲸共 3 种版本");
});

test("species-group: variantCount counts DISTINCT rarities, not instances", () => {
  // 企鹅 12 个实例只有 4 种稀有度 → 共 4 种版本
  const pets = [];
  let n = 0;
  for (const r of ["common", "uncommon", "rare", "epic"]) {
    for (let i = 0; i < 3; i++) pets.push(pet(`p${n++}`, "penguin", r));
  }
  const cards = groupBySpecies(pets);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].variantCount, 4);
  assert.equal(cards[0].variants.length, 12);
});

test("species-group: claimTarget = highest-rarity UNOWNED instance", () => {
  // 传说已被领走 → claimTarget 降级为史诗（未拥有）
  const cards = groupBySpecies([
    pet("w1", "blue_whale", "legendary", true),
    pet("w2", "blue_whale", "epic"),
    pet("w3", "blue_whale", "common"),
  ]);
  assert.equal(cards[0].claimTarget?.id, "w2");
  assert.equal(cards[0].allOwned, false, "仍有可领实例 → 非全部拥有");
  // rep 仍是传说（卡片展示最高稀有度，与领养目标解耦）
  assert.equal(cards[0].rep.id, "w1");
});

test("species-group: same rarity has multiple instances → claimTarget picks unowned one", () => {
  // 同稀有度多个实例：被领走一个，另一个仍可领
  const cards = groupBySpecies([
    pet("w1", "blue_whale", "legendary", true),
    pet("w2", "blue_whale", "legendary"),
  ]);
  assert.equal(cards[0].claimTarget?.id, "w2");
  assert.equal(cards[0].variantCount, 1, "同稀有度多实例只算 1 种版本");
});

test("species-group: all variants owned → claimTarget null + allOwned true", () => {
  const cards = groupBySpecies([
    pet("w1", "lion", "rare", true),
    pet("w2", "lion", "common", true),
  ]);
  assert.equal(cards[0].claimTarget, null);
  assert.equal(cards[0].allOwned, true);
  assert.equal(cards[0].rep.id, "w1", "rep 仍为最高稀有度记录");
});

test("species-group: empty input → empty cards", () => {
  assert.deepEqual(groupBySpecies([]), []);
});

test("species-group: missing speciesId degrades to per-instance card", () => {
  const cards = groupBySpecies([pet("a", "", "common"), pet("b", "", "common")]);
  assert.equal(cards.length, 2, "无 speciesId 时按实例自身分组，不吞数据");
});

test("species-group: unknown rarity sorts after known ones", () => {
  const cards = groupBySpecies([pet("x1", "x", "mythic"), pet("x2", "x", "common")]);
  assert.equal(cards[0].rep.traits.rarity, "common", "未知稀有度排在最后");
  assert.equal(cards[0].variantCount, 2, "未知稀有度也计入版本种数");
});

test("species-group: distinctRarityCount ignores missing rarity", () => {
  assert.equal(distinctRarityCount([{ traits: { rarity: "common" } }, { traits: { rarity: "common" } }]), 1);
  assert.equal(distinctRarityCount([{ traits: {} }, { traits: null }, {}]), 0);
  assert.equal(distinctRarityCount([]), 0);
});
