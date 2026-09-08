import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compressConversation,
  countUserTurns,
  extractTopics,
  sanitizeForTextModel,
  summarizeEarlyTurns,
} from "../src/lib/context-compress.ts";

/** 构造 UIMessage 的便捷函数。 */
function turn(user, ai = "好的~") {
  return [
    { role: "user", parts: [{ type: "text", text: user }] },
    { role: "assistant", parts: [{ type: "text", text: ai }] },
  ];
}

test("短对话（≤阈值）不做任何压缩", () => {
  const msgs = [...turn("你好"), ...turn("今天天气怎么样"), ...turn("推荐一部电影")];
  const r = compressConversation(msgs);
  assert.equal(r.summary, null);
  assert.equal(r.compressedTurns, 0);
  assert.equal(r.messages.length, msgs.length);
});

test("超过阈值后早期轮次被归档为摘要，保留最近 N 轮", () => {
  const msgs = [];
  for (let i = 1; i <= 15; i++) msgs.push(...turn(`第${i}轮：大象吃什么`));
  const r = compressConversation(msgs, { maxTurns: 12, keepRecent: 8 });
  assert.ok(r.summary, "生成了摘要");
  assert.equal(r.compressedTurns, 7, "前 7 轮被归档");
  assert.equal(countUserTurns(r.messages), 8, "保留 8 轮 user");
  assert.equal(r.messages.length, 16, "8 轮 user + 8 轮 assistant");
});

test("摘要包含话题关键词（语义总结）", () => {
  const msgs = [];
  for (let i = 1; i <= 14; i++) msgs.push(...turn("大象主要吃草和树叶吗"));
  const r = compressConversation(msgs);
  assert.ok(r.summary.includes("大象"), "摘要含中文话题「大象」");
  assert.ok(r.summary.includes(String(r.compressedTurns)), "摘要含归档轮数");
});

test("英文话题词提取", () => {
  const topics = extractTopics("Can you tell me about pandas habitat and food?", 4);
  assert.ok(topics.includes("pandas") || topics.includes("habitat"));
});

test("压缩后最近消息保持原顺序（最近轮优先）", () => {
  const msgs = [];
  for (let i = 1; i <= 13; i++) msgs.push(...turn(`轮次${i}`));
  const r = compressConversation(msgs, { maxTurns: 12, keepRecent: 5 });
  const lastUser = [...r.messages].reverse().find((m) => m.role === "user");
  assert.equal(lastUser.parts[0].text, "轮次13");
});

test("边界：恰好等于阈值不压缩，超过 1 轮触发", () => {
  const at = [];
  for (let i = 0; i < 6; i++) at.push(...turn("x"));
  const r1 = compressConversation(at, { maxTurns: 6, keepRecent: 4 });
  assert.equal(r1.summary, null);

  const over = [...at, ...turn("y")];
  const r2 = compressConversation(over, { maxTurns: 6, keepRecent: 4 });
  assert.ok(r2.summary);
  assert.equal(r2.compressedTurns, 3);
});

test("summarizeEarlyTurns 空输入安全", () => {
  assert.ok(summarizeEarlyTurns([]).includes("归档"));
});

test("sanitizeForTextModel 保留 text parts，丢弃 file/image/tool/reasoning", () => {
  const input = [
    {
      role: "user",
      parts: [
        { type: "text", text: "hello" },
        { type: "file", mediaType: "image/png", url: "https://example.com/x.png" },
      ],
    },
    {
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-get_weather",
          toolCallId: "call_1",
          state: "output-available",
          input: { city: "SZ" },
          output: { ok: true },
        },
        { type: "text", text: "It's sunny" },
        { type: "reasoning", text: "thinking..." },
      ],
    },
  ];
  const out = sanitizeForTextModel(input);
  assert.equal(out[0].parts.length, 1);
  assert.equal(out[0].parts[0].type, "text");
  assert.equal(out[0].parts[0].text, "hello");
  assert.equal(out[1].parts.length, 1);
  assert.equal(out[1].parts[0].type, "text");
  assert.equal(out[1].parts[0].text, "It's sunny");
});

test("sanitizeForTextModel 整条无 text 时 parts 置空（不进模型）", () => {
  const input = [
    {
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "tool-foo", toolCallId: "c", state: "output-available", input: {}, output: {} },
      ],
    },
  ];
  const out = sanitizeForTextModel(input);
  assert.equal(out[0].parts.length, 0);
});

test("sanitizeForTextModel 容错：parts 缺失或非数组", () => {
  const input = [
    { role: "user", parts: undefined },
    { role: "assistant", parts: null },
    { role: "user", parts: "not-an-array" },
    { role: "user" },
  ];
  const out = sanitizeForTextModel(input);
  for (const m of out) {
    assert.ok(Array.isArray(m.parts), "parts is array");
    assert.equal(m.parts.length, 0);
  }
});

test("sanitizeForTextModel 不修改 message.id 和 role", () => {
  const input = [
    { id: "abc-1", role: "user", parts: [{ type: "text", text: "hi" }] },
  ];
  const out = sanitizeForTextModel(input);
  assert.equal(out[0].id, "abc-1");
  assert.equal(out[0].role, "user");
});
