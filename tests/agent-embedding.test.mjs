import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  DEDUP_SIMILARITY_THRESHOLD,
  EMBEDDING_DIM,
  embed,
  isDuplicate,
  normalizeText,
  tokenize,
} from "../src/lib/agent-embedding.ts";

test("embed produces fixed-dimension normalized vectors", () => {
  const v = embed("用户喜欢喝咖啡");
  assert.equal(v.length, EMBEDDING_DIM);
  assert.ok(v.every((x) => typeof x === "number" && Number.isFinite(x)));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, "L2 normalized");
});

test("identical memories are duplicates (similarity >= 0.9)", () => {
  const a = embed("用户喜欢喝咖啡");
  assert.equal(isDuplicate(a, embed("用户喜欢喝咖啡")), true);
});

test("near-duplicate (whitespace/case/punctuation) is deduped", () => {
  const a = embed("Agent 今日发布了 X 帖子。");
  const b = embed("agent 今日发布了 x 帖子");
  assert.equal(isDuplicate(a, b), true, "normalized forms are identical");
  assert.ok(cosineSimilarity(a, b) >= DEDUP_SIMILARITY_THRESHOLD);
});

test("clearly different memories are NOT duplicates", () => {
  const a = embed("用户喜欢喝咖啡");
  const b = embed("今日天气晴朗适合出门散步");
  assert.equal(isDuplicate(a, b), false);
});

test("cosine similarity is symmetric", () => {
  const a = embed("用户喜欢喝咖啡并且热爱工作");
  const b = embed("今日天气晴朗适合出门散步");
  assert.equal(
    cosineSimilarity(a, b),
    cosineSimilarity(b, a),
  );
});

test("normalizeText strips punctuation/whitespace and lowercases", () => {
  assert.equal(normalizeText(" Hello, 世界！ "), "hello世界");
});

test("tokenize yields cjk chars, latin words and bigrams", () => {
  const tokens = tokenize("爱喝咖啡");
  assert.ok(tokens.includes("c:爱"));
  assert.ok(tokens.some((t) => t.startsWith("b:")));
  const en = tokenize("hello world");
  assert.ok(en.includes("w:hello"));
  assert.ok(en.includes("w:world"));
});
