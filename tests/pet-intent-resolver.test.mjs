/**
 * 契约测试 · 宠物对话意图情绪解析器（通用状态机 · 对话驱动层）
 *
 *  A) 关键词意图短路（零 token）：五意图命中 / 未命中 null / 英文词边界防误伤；
 *  B) 严格契约解析 parseIntentResponse：合法/包裹/越界归一/intensity 钳 0-1/旧字段兼容/拒非法；
 *  C) resolvePetIntent 三层链（注入式 mock 零网络）：关键词短路不调 LLM /
 *     LLM 正常 / 非法 JSON→inferMood 降级 / 无命中→{idle,thinking,0.3} / 超时→降级；
 *  D) 养成状态修正：饥饿覆盖模型情绪 / 久未访问 sleepy / 饥饿优先于久别；
 *  E) /api/pet/chat 接线：resolver 引入 / 退款按 source / 观测落库 / intent+emotion 下发。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTENT_KEYWORDS,
  PET_INTENTS,
  matchKeywordIntent,
  parseIntentResponse,
  resolvePetIntent,
} from "../src/lib/pets/intent-resolver.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const BASE = {
  message: "",
  locale: "zh",
  petType: "species:persian",
  petName: "阿橘",
  happiness: 60,
  hungerLevel: 80,
  absenceHours: 0,
};

// ───────────── A1) 关键词五意图命中（中英文） ─────────────
test("pet-intent(A1): 关键词意图短路——pet/eat/play/sleep/wake 五意图命中", () => {
  const cases = [
    ["摸摸你的头", "pet", "happy"],
    ["pat pat", "pet", "happy"],
    ["喂你吃罐头", "eat", "hungry"],
    ["feed you a snack", "eat", "hungry"],
    ["陪我玩球", "play", "happy"],
    ["let's play a game", "play", "happy"],
    ["晚安，去睡吧", "sleep", "sleepy"],
    ["good night", "sleep", "sleepy"],
    ["早上好，起床啦", "wake", "idle"],
    ["wake up!", "wake", "idle"],
  ];
  for (const [msg, intent, emotion] of cases) {
    const hit = matchKeywordIntent(msg);
    assert.ok(hit, `「${msg}」应命中关键词`);
    assert.equal(hit.intent, intent, `「${msg}」→ ${intent}`);
    assert.equal(hit.emotion, emotion, `「${msg}」情绪 ${emotion}`);
  }
});

// ───────────── A2) 未命中 null + 词边界防误伤 + 意图枚举值域 ─────────────
test("pet-intent(A2): 未命中返回 null（走 LLM）+ 词边界防误伤 + 意图值域锁", () => {
  assert.equal(matchKeywordIntent("今天天气怎么样"), null, "普通问句不命中");
  assert.equal(matchKeywordIntent("pattern matching is fun"), null, "pat 不误伤 pattern");
  assert.equal(matchKeywordIntent(""), null, "空串不命中");
  assert.ok(INTENT_KEYWORDS.length >= 5, "配置表 ≥5 规则（映射走配置零硬编码）");
  assert.deepEqual(
    [...PET_INTENTS],
    ["idle", "pet", "eat", "play", "sleep", "wake"],
    "意图值域 = 契约 Trigger 五值 + idle",
  );
});

// ───────────── B1) parseIntentResponse 严格契约 ─────────────
test("pet-intent(B1): 严格契约解析——合法/包裹/归一/钳制/旧字段兼容/拒非法", () => {
  const good = parseIntentResponse('{"intent":"play","emotion":"happy","intensity":0.9,"reply":"好耶"}');
  assert.deepEqual(good, { intent: "play", emotion: "happy", intensity: 0.9, reply: "好耶" });
  // ```json 包裹 + 前后废话
  const wrapped = parseIntentResponse('前置```json\n{"intent":"pet","emotion":"happy","intensity":0.6,"reply":"蹭蹭"}\n```后缀');
  assert.equal(wrapped?.intent, "pet");
  assert.equal(wrapped?.reply, "蹭蹭");
  // 越界 intent/emotion → idle；intensity 钳 0-1
  const wild = parseIntentResponse('{"intent":"fly","emotion":"rage","intensity":7,"reply":"x"}');
  assert.deepEqual(wild, { intent: "idle", emotion: "idle", intensity: 1, reply: "x" });
  const neg = parseIntentResponse('{"intent":"idle","emotion":"sad","intensity":-2,"reply":"y"}');
  assert.equal(neg?.intensity, 0, "负强度钳 0");
  // 旧字段兼容（text/mood 漂移）
  const legacy = parseIntentResponse('{"text":"喵","mood":"sleepy"}');
  assert.deepEqual(legacy, { intent: "idle", emotion: "sleepy", intensity: 0.5, reply: "喵" });
  // 不可修复 → null
  assert.equal(parseIntentResponse("不是 JSON"), null);
  assert.equal(parseIntentResponse('{"intent":"pet"}'), null, "缺 reply 拒绝");
  assert.equal(parseIntentResponse(""), null);
});

// ───────────── C1) 关键词短路：零 LLM 调用 + 回复取角色台词库 ─────────────
test("pet-intent(C1): 关键词短路零 token（generate 不被调用，回复=角色台词）", async () => {
  let called = 0;
  const generate = async () => {
    called += 1;
    return { text: "{}", tokens: 1 };
  };
  const r = await resolvePetIntent({ ...BASE, message: "摸摸头" }, { generate });
  assert.equal(called, 0, "关键词命中不调 LLM");
  assert.equal(r.source, "keyword");
  assert.equal(r.intent, "pet");
  assert.equal(r.emotion, "happy");
  assert.ok(r.reply.length > 0, "台词库回复非空");
});

// ───────────── C2) LLM 正常路径：source=llm + 观测字段 + 角色 prompt ─────────────
test("pet-intent(C2): 未命中关键词 → LLM 契约解析（观测记录 + 角色 prompt 构建）", async () => {
  let seenSystem = "";
  const generate = async (opts) => {
    seenSystem = opts.system;
    return { text: '{"intent":"play","emotion":"happy","intensity":0.8,"reply":"接球！"}', tokens: 42 };
  };
  const r = await resolvePetIntent({ ...BASE, message: "今天想干点啥" }, { generate });
  assert.equal(r.source, "llm");
  assert.equal(r.intent, "play");
  assert.equal(r.reply, "接球！");
  assert.equal(r.tokens, 42);
  assert.ok(typeof r.llmMs === "number" && r.llmMs >= 0, "llmMs 记录");
  assert.ok(seenSystem.includes("阿橘"), "system 经角色注册表构建（含宠物名）");
  assert.ok(seenSystem.includes('"intent"'), "system 注入契约 v2");
});

// ───────────── C3) 降级链：非法 JSON → inferMood 关键词情绪 + 台词库 ─────────────
test("pet-intent(C3): LLM 非法 JSON → inferMood 降级（source=fallback，情绪仍随输入）", async () => {
  const generate = async () => ({ text: "模型说了句废话，没有 JSON" });
  // 「我饿了怎么办」命中 inferMood 情绪词（饿）但不命中 intent 喂食动作词（喂你/吃点/罐头…）
  const r = await resolvePetIntent({ ...BASE, message: "我饿了怎么办" }, { generate });
  assert.equal(r.source, "fallback");
  assert.equal(r.intent, "idle");
  assert.equal(r.emotion, "hungry", "降级情绪随输入关键词");
  assert.ok(r.reply.length > 0, "台词库兜底回复");
});

// ───────────── C4) 降级链默认：无命中 → { idle, thinking, 0.3 } ─────────────
test("pet-intent(C4): LLM 抛错且关键词无命中 → 默认 { idle, thinking, 0.3 }", async () => {
  const generate = async () => {
    throw new Error("provider down");
  };
  const r = await resolvePetIntent({ ...BASE, message: "嗯，就是随便聊聊" }, { generate });
  assert.equal(r.source, "fallback");
  assert.equal(r.intent, "idle");
  assert.equal(r.emotion, "thinking");
  assert.equal(r.intensity, 0.3);
});

// ───────────── C5) LLM 超时 → 降级链 ─────────────
test("pet-intent(C5): LLM 超 5s 超时 → 降级链（timeoutMs 注入 50ms 模拟）", async () => {
  const generate = () => new Promise((resolve) => setTimeout(() => resolve({ text: "{}" }), 500));
  const r = await resolvePetIntent({ ...BASE, message: "zzz 没啥关键词" }, { generate, timeoutMs: 50 });
  assert.equal(r.source, "fallback", "超时走降级链");
});

// ───────────── D1) 饥饿修正覆盖模型情绪 ─────────────
test("pet-intent(D1): 饥饿度 ≤ 阈值 → emotion=hungry 覆盖模型判断（intensity 抬 ≥0.6）", async () => {
  const generate = async () => ({ text: '{"intent":"play","emotion":"happy","intensity":0.2,"reply":"玩！"}' });
  const r = await resolvePetIntent({ ...BASE, message: "今天想干点啥", hungerLevel: 10 }, { generate });
  assert.equal(r.emotion, "hungry", "饥饿覆盖模型情绪");
  assert.equal(r.intent, "play", "意图保留不覆盖");
  assert.ok(r.intensity >= 0.6, "强度抬升");
});

// ───────────── D2) 久未访问修正（饥饿优先） ─────────────
test("pet-intent(D2): 距上次互动 ≥ LONG_ABSENCE_HOURS → emotion=sleepy（饥饿优先于久别）", async () => {
  const generate = async () => ({ text: '{"intent":"idle","emotion":"happy","intensity":0.8,"reply":"想你了"}' });
  const r = await resolvePetIntent({ ...BASE, message: "今天想干点啥", absenceHours: 48 }, { generate });
  assert.equal(r.emotion, "sleepy", "久别重逢没睡醒");
  const r2 = await resolvePetIntent({ ...BASE, message: "今天想干点啥", absenceHours: 48, hungerLevel: 5 }, { generate });
  assert.equal(r2.emotion, "hungry", "饥饿优先于久别");
  // 无修正直通：状态正常 → 模型情绪原样
  const r3 = await resolvePetIntent({ ...BASE, message: "今天想干点啥" }, { generate });
  assert.equal(r3.emotion, "happy", "状态正常不修正");
});

// ───────────── E1) /api/pet/chat 接线锁定 ─────────────
test("pet-intent(E1): chat 路由接线——resolver/退款按 source/观测落库/契约下发", () => {
  const src = read("src/app/api/pet/chat/route.ts");
  assert.ok(src.includes('from "@/lib/pets/intent-resolver"'), "resolver 引入");
  assert.ok(src.includes("resolvePetIntent({"), "resolver 调用");
  assert.ok(src.includes('source === "fallback" && charged'), "降级才退款（需求五.2）");
  assert.ok(src.includes("resolution.llmMs") && src.includes("resolution.tokens"), "LLM 观测落库");
  assert.ok(src.includes("intent: resolution.intent") && src.includes("emotion: resolution.emotion"), "契约下发 intent+emotion");
  // 旧直调已清除（解析链内聚在 resolver）
  for (const gone of ["generateThrottled(", "parsePetChatResponse", "resolveCharacter"]) {
    assert.ok(!src.includes(gone), `chat 路由不得残留 ${gone}`);
  }
});
