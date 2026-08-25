import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSpeciesPetType,
  speciesIdOf,
  buildSpeciesPetConfig,
  buildInteractSuggestions,
  translateTrait,
  buildSpeciesSystemPrompt,
} from "../src/lib/species-prompt.ts";

const info = {
  id: "golden_retriever",
  nameZh: "金毛寻回犬",
  nameEn: "Golden Retriever",
  category: "犬科",
  habitat: "英国",
  defaultDescriptionZh: "这是一只来自英国的温柔金毛寻回犬，性格友善忠诚。",
  defaultDescriptionEn: "A gentle Golden Retriever from the UK, friendly and loyal.",
  imageUrl: "/images/pets/golden.webp",
  traits: { element: "earth", rarity: "common", personality: "温柔" },
};

test("species pet type helpers", () => {
  assert.equal(isSpeciesPetType("species:golden_retriever"), true);
  assert.equal(isSpeciesPetType("fox"), false);
  assert.equal(isSpeciesPetType(null), false);
  assert.equal(speciesIdOf("species:golden_retriever"), "golden_retriever");
});

test("buildSpeciesPetConfig builds a working persona (zh)", () => {
  const cfg = buildSpeciesPetConfig(info, "zh");
  assert.equal(cfg.name, "金毛寻回犬");
  assert.equal(cfg.avatar, info.imageUrl);
  assert.equal(cfg.personality, "温柔");
  assert.ok(cfg.welcome.includes("金毛寻回犬"), "welcome 使用中文名");
  // System Prompt 必须注入物种知识 + 性格（温柔 → gentle）
  assert.ok(cfg.systemPrompt.includes("Golden Retriever"), "prompt 含物种英文名");
  assert.ok(cfg.systemPrompt.includes("gentle"), "prompt 含性格翻译");
  assert.ok(cfg.systemPrompt.includes("UK"), "prompt 含栖息地");
  assert.equal(cfg.speciesInfo.habitat, "英国");
});

test("buildSpeciesPetConfig uses English name for en locale", () => {
  const cfg = buildSpeciesPetConfig(info, "en");
  assert.equal(cfg.name, "Golden Retriever");
  assert.ok(cfg.welcome.includes("Golden Retriever"));
  assert.equal(cfg.speciesInfo.description, info.defaultDescriptionEn);
});

test("system prompt never calls itself an AI assistant", () => {
  const prompt = buildSpeciesSystemPrompt(info);
  assert.ok(!/you are an? ai assistant/i.test(prompt));
  assert.ok(prompt.includes("Golden Retriever"));
});

test("interact suggestions are localized (3 each)", () => {
  const zh = buildInteractSuggestions("温柔", "earth", "zh");
  const en = buildInteractSuggestions("温柔", "earth", "en");
  assert.equal(zh.length, 3);
  assert.equal(en.length, 3);
  assert.ok(zh[0].includes("它"), "zh 建议面向宠物");
  assert.ok(en[0].includes("gentle"), "en 建议含性格翻译");
});

test("translateTrait maps known traits and falls back", () => {
  assert.equal(translateTrait("勇敢"), "brave");
  assert.equal(translateTrait("治愈"), "soothing");
  assert.equal(translateTrait("神秘"), "mysterious");
  assert.equal(translateTrait(undefined), "friendly");
});
