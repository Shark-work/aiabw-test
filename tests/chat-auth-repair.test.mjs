// 聊天页无回复 + i18n 原始 key 暴露的回归测试
//
// 事故根因（2026-09 排查）：
//  1) /api/chat 自 5ac2070 起强制 Authorization: Bearer（token 存 localStorage.aiabw_token），
//     而 useChat 默认 transport 不带任何请求头 → 浏览器端永远 401 → AI 无回复；
//     error 处理只认 blocked/quota_exceeded，401 被静默吞掉（与 b104e3d 修 pay/create 同类）。
//  2) chat-panel.tsx 用 t("you") 渲染用户昵称，但 chatPanel.you 在 zh/en 都从未定义
//     → 界面直接显示原始 key「chatPanel.you」。
//  3) chat_quotas 缺 (user_id,date) 唯一索引 → 计数 UPSERT 的 ON CONFLICT 报 42P10，
//     每日额度永远不累计（硬限制形同虚设）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ───────────── 1) useChat 必须携带 Bearer token ─────────────
test("chat-panel: useChat 配置 DefaultChatTransport 并从 localStorage 注入 Authorization", () => {
  const ts = read("src/components/chat/chat-panel.tsx");
  assert.ok(ts.includes("DefaultChatTransport"), "imports DefaultChatTransport");
  assert.ok(/transport:\s*new DefaultChatTransport\(/.test(ts), "useChat receives transport");
  // headers 为函数（每次请求动态读 token），且来源是 localStorage.aiabw_token
  const m = ts.match(/DefaultChatTransport\(\{[\s\S]{0,400}?\}\)/);
  assert.ok(m, "transport options block found");
  assert.ok(/headers:\s*\(\)\s*(:[^=]+)?=>/.test(m[0]), "headers is a per-request function");
  assert.ok(m[0].includes('localStorage.getItem("aiabw_token")'), "reads aiabw_token");
  assert.ok(/Authorization:\s*`Bearer \$\{token\}`/.test(m[0]), "sends Bearer token");
});

// ───────────── 2) 401 不再静默失败 ─────────────
test("chat-panel: SIGN_IN_REQUIRED(401) 清理失效 token 并跳转登录页", () => {
  const ts = read("src/components/chat/chat-panel.tsx");
  assert.ok(ts.includes('parsed.code === "SIGN_IN_REQUIRED"'), "handles SIGN_IN_REQUIRED");
  assert.ok(ts.includes('localStorage.removeItem("aiabw_token")'), "clears stale token");
  assert.ok(/\/login\?redirect=/.test(ts), "redirects to /login with redirect param");
});

// ───────────── 3) chatPanel.you i18n ─────────────
test("messages: zh/en 均定义 chatPanel.you（用户消息昵称不再暴露原始 key）", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.equal(zh.chatPanel.you, "你");
  assert.equal(en.chatPanel.you, "You");
});

// ───────────── 4) chatPanel 引用的 key 在双语种齐全 ─────────────
test("messages: chat-panel.tsx 使用的 chatPanel key 在 zh/en 均存在", () => {
  const ts = read("src/components/chat/chat-panel.tsx");
  // 只统计主组件 chatPanel 命名空间的 t("...")（MemoryHint 用 memories 命名空间，单独检查）
  const usedKeys = [
    ...new Set(
      [...ts.matchAll(/\bt\(\s*"([a-zA-Z0-9_]+)"/g)].map((m) => m[1]),
    ),
  ].filter((k) => k !== "upgradeHint"); // upgradeHint 属于 memories 命名空间（MemoryHint 内独立 useTranslations）
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const k of usedKeys) {
    assert.ok(k in zh.chatPanel, `zh.chatPanel.${k} missing`);
    assert.ok(k in en.chatPanel, `en.chatPanel.${k} missing`);
  }
  assert.ok("upgradeHint" in zh.memories && "upgradeHint" in en.memories, "memories.upgradeHint exists");
});

// ───────────── 5) chat_quotas 唯一约束（ON CONFLICT 依赖） ─────────────
test("db/client.ts: chat_quotas 具备 (user_id,date) 唯一索引", () => {
  const ts = read("src/db/client.ts");
  assert.ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS "uq_chat_quotas_user_date" ON "chat_quotas" \("user_id", "date"\)/.test(ts),
    "uq_chat_quotas_user_date unique index in SCHEMA_INDEXES",
  );
});

test("drizzle/0018: 唯一索引 + user_id uuid（与运行时 DDL 对齐）", () => {
  const sql = read("drizzle/0018_subscription.sql");
  assert.ok(sql.includes("uq_chat_quotas_user_date"), "unique index present");
  assert.ok(/UNIQUE INDEX IF NOT EXISTS "uq_chat_quotas_user_date"/.test(sql), "is UNIQUE");
  assert.ok(/"user_id"\s+uuid NOT NULL REFERENCES "users"\("id"\)/.test(sql), "user_id is uuid");
});

// ───────────── 6) /api/chat 仍保留 401 JSON 协议（前端解析依赖） ─────────────
test("api/chat: 未登录返回 code=SIGN_IN_REQUIRED 的 JSON（前端 error.message 解析协议）", () => {
  const ts = read("src/app/api/chat/route.ts");
  assert.ok(ts.includes('code: "SIGN_IN_REQUIRED"'), "401 payload keeps SIGN_IN_REQUIRED code");
  assert.ok(ts.includes("status: 401"), "returns HTTP 401");
});
