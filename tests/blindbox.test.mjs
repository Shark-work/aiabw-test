import { test } from "node:test";
import assert from "node:assert/strict";
import { weightedPick, randomDna } from "../src/lib/blindbox.ts";

test("blindbox: weightedPick returns one of the probability keys", () => {
  const probs = { common: 0.7, rare: 0.2, epic: 0.09, legendary: 0.01 };
  for (let i = 0; i < 100; i++) {
    const r = weightedPick(probs);
    assert.ok(r in probs, `key ${r} 必须在概率映射中`);
  }
});

test("blindbox: distribution approximates configured odds (70/20/9/1)", () => {
  const probs = { common: 70, rare: 20, epic: 9, legendary: 1 };
  const N = 20000;
  const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (let i = 0; i < N; i++) counts[weightedPick(probs)]++;
  const pct = (k) => (counts[k] / N) * 100;
  assert.ok(pct("common") > 65 && pct("common") < 75, `common ${pct("common")}%`);
  assert.ok(pct("rare") > 15 && pct("rare") < 25, `rare ${pct("rare")}%`);
  assert.ok(pct("legendary") > 0.3 && pct("legendary") < 2.5, `legendary ${pct("legendary")}%`);
});

test("blindbox: empty / all-zero probabilities fall back to common", () => {
  assert.equal(weightedPick({}), "common");
  assert.equal(weightedPick(null), "common");
  assert.equal(weightedPick(undefined), "common");
  assert.equal(weightedPick({ common: 0, rare: 0 }), "common");
  assert.equal(weightedPick({ common: -1, rare: 0 }), "common");
});

test("blindbox: single-key probabilities always return that key", () => {
  assert.equal(weightedPick({ legendary: 1 }), "legendary");
});

test("blindbox: deterministic with mocked rand source", () => {
  // rand=0 → 命中第一项；rand=0.99 → 接近末尾
  const probs = { common: 1, rare: 1 };
  assert.equal(weightedPick(probs, () => 0), "common");
  assert.equal(weightedPick(probs, () => 0.999999), "rare");
});

test("blindbox: randomDna returns valid element & personality", () => {
  const elements = ["fire", "water", "earth", "air"];
  const personalities = ["温柔", "勇敢", "机灵", "慵懒", "活泼", "沉稳"];
  for (let i = 0; i < 50; i++) {
    const dna = randomDna();
    assert.ok(elements.includes(dna.element));
    assert.ok(personalities.includes(dna.personality));
  }
});
