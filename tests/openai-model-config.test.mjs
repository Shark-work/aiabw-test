// OPENAI_API_KEY 聊天模型配置的回归测试
//
// 背景（2026-09）：get-model.ts 原先写死阿里云百炼（BAILIAN_API_KEY + DashScope
// baseURL）。用户要求统一从 OPENAI_API_KEY 读取，且支持任意 OpenAI 兼容端点
//（OPENAI_BASE_URL / OPENAI_MODEL）。重构为三级提供商回退：
//   DEEPSEEK → OPENAI → BAILIAN（第一个配置了 API Key 的生效）。
// 注（ff906ea）：优先级由 OPENAI 优先调整为 DEEPSEEK 优先——Vercel 上残留的
//   OPENAI_API_KEY 是失效的 ark- key（401），而 DEEPSEEK_API_KEY 有效。
// /api/chat、agent-psychology、handbook、memory、memory-context、social-poster
// 共 6 处调用点全部经由 getModel()，单点改造即全站生效。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── 1) DEEPSEEK_API_KEY 为最高优先级 ─────────────
test("get-model: DEEPSEEK_API_KEY 是回退链的第一优先级", () => {
  const ts = read("src/lib/get-model.ts");
  const iOpenai = ts.indexOf("process.env.OPENAI_API_KEY");
  const iDeepseek = ts.indexOf("process.env.DEEPSEEK_API_KEY");
  const iBailian = ts.indexOf("process.env.BAILIAN_API_KEY");
  assert.ok(iOpenai > -1, "reads OPENAI_API_KEY");
  assert.ok(iDeepseek > -1, "reads DEEPSEEK_API_KEY");
  assert.ok(iBailian > -1, "reads BAILIAN_API_KEY");
  assert.ok(iDeepseek < iOpenai && iOpenai < iBailian, "priority order DEEPSEEK → OPENAI → BAILIAN");
  assert.ok(/if \(process\.env\.DEEPSEEK_API_KEY\)/.test(ts), "DEEPSEEK branch guards on key presence");
});

// ───────────── 2) OPENAI_BASE_URL / OPENAI_MODEL 可配置 ─────────────
test("get-model: OPENAI_BASE_URL 可选（默认官方端点）+ OPENAI_MODEL 默认 gpt-4o-mini", () => {
  const ts = read("src/lib/get-model.ts");
  assert.ok(/OPENAI_BASE_URL \|\| undefined/.test(ts), "OPENAI_BASE_URL optional, unset → SDK default api.openai.com");
  assert.ok(/OPENAI_MODEL \?\? 'gpt-4o-mini'/.test(ts), "OPENAI_MODEL default gpt-4o-mini");
});

// ───────────── 3) DEEPSEEK 回退 ─────────────
test("get-model: DEEPSEEK 回退带默认 baseURL 与模型", () => {
  const ts = read("src/lib/get-model.ts");
  assert.ok(ts.includes("https://api.deepseek.com"), "deepseek default baseURL");
  assert.ok(/DEEPSEEK_MODEL \?\? 'deepseek-chat'/.test(ts), "deepseek default model");
});

// ───────────── 4) BAILIAN 回退保留（向后兼容） ─────────────
test("get-model: BAILIAN 回退保留 DashScope 端点与 qwen-turbo 默认值", () => {
  const ts = read("src/lib/get-model.ts");
  assert.ok(ts.includes("https://dashscope.aliyuncs.com/compatible-mode/v1"), "dashscope baseURL kept");
  assert.ok(/BAILIAN_MODEL \?\? 'qwen-turbo'/.test(ts), "bailian default model kept");
});

// ───────────── 5) 统一使用 Chat Completions（文本模型安全） ─────────────
test("get-model: 使用 client.chat（Chat Completions）而非 Responses API", () => {
  const ts = read("src/lib/get-model.ts");
  assert.ok(/return client\.chat\(name\)/.test(ts), "returns client.chat(name)");
  assert.ok(!/return client\(name\)/.test(ts), "does not use Responses API");
});

// ───────────── 6) /api/chat 仍经由 getModel() 取模型 ─────────────
test("api/chat: streamText 的 model 来自 getModel()（单点配置生效）", () => {
  const ts = read("src/app/api/chat/route.ts");
  assert.ok(/import \{ getModel \} from "@\/lib\/get-model"/.test(ts), "imports getModel");
  assert.ok(/model:\s*getModel\(\)/.test(ts), "streamText uses getModel()");
  assert.ok(/toUIMessageStreamResponse\(/.test(ts), "returns streaming UI message response");
  // 流式错误必须透出真实原因（onError），否则上游模型 401/超时只表现为「AI 无回复」
  assert.ok(/onError:\s*\(err\)/.test(ts), "stream response wires onError diagnostics");
});

// ───────────── 7) .env.example 文档同步 ─────────────
test(".env.example: 文档化 OPENAI_API_KEY 及三级回退", () => {
  const env = read(".env.example");
  assert.ok(/^OPENAI_API_KEY=/m.test(env), "OPENAI_API_KEY documented");
  assert.ok(/OPENAI_BASE_URL/.test(env) && /OPENAI_MODEL/.test(env), "OPENAI_BASE_URL/OPENAI_MODEL documented");
  assert.ok(/BAILIAN_API_KEY/.test(env), "BAILIAN fallback still documented");
});
