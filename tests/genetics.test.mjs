import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breedDna,
  makeNfrHashId,
  rarityIndex,
  RARITY_CHAIN,
} from "../src/lib/genetics.ts";

test("rarityIndex 映射与未知回退", () => {
  assert.equal(rarityIndex("common"), 0);
  assert.equal(rarityIndex("legendary"), RARITY_CHAIN.length - 1);
  assert.equal(rarityIndex("whatever"), 0);
  assert.equal(rarityIndex(undefined), 0);
});

test("breedDna 子代稀有度默认不高于双亲", () => {
  for (let i = 0; i < 200; i++) {
    const child = breedDna({ element: "fire", personality: "勇敢", rarity: "rare" }, { rarity: "common" });
    assert.ok(
      rarityIndex(child.rarity) <= rarityIndex("rare"),
      `子代稀有度 ${child.rarity} 应 <= rare`,
    );
  }
});

test("breedDna 元素来自双亲之一", () => {
  for (let i = 0; i < 100; i++) {
    const child = breedDna({ element: "fire" }, { element: "water" });
    assert.ok(child.element === "fire" || child.element === "water");
  }
});

test("breedDna 性格交叉 + 变异在池内", () => {
  const pool = ["勇敢", "温柔", "机灵", "高傲", "慵懒", "粘人", "活泼", "沉稳", "神秘", "治愈"];
  for (let i = 0; i < 100; i++) {
    const child = breedDna({ personality: "温柔" }, { personality: "勇敢" });
    assert.ok(
      child.personality === "温柔" || child.personality === "勇敢" || pool.includes(child.personality),
    );
  }
});

test("breedDna 每次生成唯一 seed（同亲本可产不同子代）", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const child = breedDna({ element: "fire", personality: "温柔", rarity: "rare" }, { element: "earth", personality: "勇敢", rarity: "common" });
    seen.add(String(child.seed));
  }
  assert.ok(seen.size >= 45, `seed 唯一性: ${seen.size}/50`);
});

test("makeNfrHashId 确定性 + 不同 salt 不同", () => {
  const dna = { element: "fire", personality: "温柔", rarity: "common" };
  const h1 = makeNfrHashId("golden_retriever", dna, 1, "u1", "s1");
  const h2 = makeNfrHashId("golden_retriever", dna, 1, "u1", "s1");
  const h3 = makeNfrHashId("golden_retriever", dna, 1, "u1", "s2");
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 64);
});

test("双 legendary 亲本子代仍为 legendary（链顶）", () => {
  const child = breedDna({ rarity: "legendary" }, { rarity: "legendary" });
  assert.equal(child.rarity, "legendary");
});
