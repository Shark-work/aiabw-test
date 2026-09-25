// 宠物长期记忆（VIP 专属）单测
// 覆盖：pet_memories 表 DDL/schema、hasMemoryAccess、记忆提取 prompt、去重逻辑、
//       召回排序/上限/times_recalled、免费用户不触发、管理 API、记忆管理页面 VIP 拦截、
//       导航栏 Memory 入口、i18n memories 命名空间
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd());

function readText(p) {
  return readFileSync(p, "utf8");
}
function readJson(p) {
  return JSON.parse(readText(p));
}

// --- 1. 数据库 DDL 与 schema ---
test("migration 0019_pet_memories.sql exists and creates pet_memories table", () => {
  const p = join(ROOT, "drizzle/0019_pet_memories.sql");
  assert.ok(existsSync(p), "0019_pet_memories.sql should exist");
  const sql = readText(p);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "pet_memories"/);
  for (const col of [
    "id",
    "user_id",
    "pet_id",
    "memory_type",
    "content",
    "source_message",
    "importance",
    "times_recalled",
    "last_recalled_at",
    "expires_at",
    "created_at",
  ]) {
    assert.match(sql, new RegExp(`"${col}"`), `should have column ${col}`);
  }
  // 4 类记忆 CHECK 约束
  assert.match(sql, /'preference'.*'event'.*'fact'.*'emotion'/);
  // importance 1-10 约束
  assert.match(sql, /importance.*BETWEEN 1 AND 10/);
  // 索引
  for (const idx of [
    "idx_pet_memories_user",
    "idx_pet_memories_user_pet",
    "idx_pet_memories_user_type",
  ]) {
    assert.match(sql, new RegExp(`"${idx}"`), `should have index ${idx}`);
  }
});

test("schema.ts: petMemories table exported with all 4 types enum", () => {
  const schema = readText(join(ROOT, "src/db/schema.ts"));
  assert.match(schema, /export const petMemories/);
  assert.match(
    schema,
    /memoryType:\s*text\('memory_type',\s*\{\s*enum:\s*\['preference',\s*'event',\s*'fact',\s*'emotion'\]/,
  );
});

test("client.ts: pet_memories DDL is registered in SCHEMA_CREATES", () => {
  const client = readText(join(ROOT, "src/db/client.ts"));
  assert.match(client, /CREATE TABLE IF NOT EXISTS "pet_memories"/);
  assert.match(client, /idx_pet_memories_user/);
});

// --- 2. hasMemoryAccess + memory-gate ---
test("memory-gate.ts: hasMemoryAccess queries getActiveSubscription", () => {
  const gate = readText(join(ROOT, "src/lib/memory-gate.ts"));
  assert.match(gate, /export async function hasMemoryAccess/);
  assert.match(gate, /getActiveSubscription/);
  assert.match(gate, /if \(!userId\) return false/);
});

// --- 3. memory-context.ts：prompt、去重、排序、上限 ---
test("memory-context.ts: exports extractMemories / recallMemory / renderMemoryContext / parseExtractedMemories", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  assert.match(ctx, /export (async )?function parseExtractedMemories/);
  assert.match(ctx, /export async function extractMemories/);
  assert.match(ctx, /export async function recallMemory/);
  assert.match(ctx, /export function renderMemoryContext/);
});

test("memory-context.ts: EXTRACT_PROMPT contains 4 types and JSON example", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  for (const ty of ["preference", "event", "fact", "emotion"]) {
    assert.match(ctx, new RegExp(`-?\\s*${ty}：`), `prompt should mention ${ty}`);
  }
  assert.match(ctx, /\{messages\}/);
  assert.match(ctx, /\[\s*\{[^]*"type"/);
});

test("memory-context.ts: parseExtractedMemories strips markdown codefence and validates type", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  // 源码包含 fence = text.match(...)（codefence 提取）
  assert.match(ctx, /fence\s*=\s*text\.match/);
  // 也包含 markdown 反引号字面量
  assert.ok(ctx.includes("```"), "should contain triple backticks");
  // 4 类白名单
  assert.match(
    ctx,
    /\["preference",\s*"event",\s*"fact",\s*"emotion"\]\.includes/,
  );
});

test("memory-context.ts: dedup uses Jaccard similarity with threshold", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  assert.match(ctx, /DEDUP_SIMILARITY_THRESHOLD/);
  assert.match(ctx, /jaccardSimilarity/);
});

test("memory-context.ts: recall caps to RECALL_MAX_RESULTS (3-5)", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  assert.match(ctx, /RECALL_MAX_RESULTS\s*=\s*[3-5]/);
  assert.match(ctx, /slice\(0,\s*RECALL_MAX_RESULTS\)/);
});

test("memory-context.ts: recall sorts by score then importance then recent", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  assert.match(ctx, /scored\.sort/);
  assert.match(ctx, /RECALL_RECENT_BOOST_DAYS\s*\*\s*24/);
});

test("memory-context.ts: recall increments times_recalled and updates last_recalled_at", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  assert.match(
    ctx,
    /timesRecalled:\s*sql`\$\{petMemories\.timesRecalled\}\s*\+\s*1`/,
  );
  assert.match(ctx, /lastRecalledAt:\s*now/);
});

test("memory-context.ts: renderMemoryContext formats with [你记得关于用户...] 段落", () => {
  const ctx = readText(join(ROOT, "src/lib/memory-context.ts"));
  assert.match(ctx, /\[你记得关于用户的以下事情/);
  for (const lbl of ["偏好", "事件", "事实", "情绪"]) {
    assert.match(ctx, new RegExp(`:\\s*"${lbl}"`));
  }
});

// --- 4. chat/route.ts 集成：仅 VIP 触发提取 ---
test("chat/route.ts: imports extractMemories / recallMemory / hasMemoryAccess from memory modules", () => {
  const route = readText(join(ROOT, "src/app/api/chat/route.ts"));
  assert.match(
    route,
    /import\s*\{[^}]*extractMemories[^}]*\}\s*from\s*"@\/lib\/memory-context"/,
  );
  assert.match(
    route,
    /import\s*\{[^}]*recallMemory[^}]*\}\s*from\s*"@\/lib\/memory-context"/,
  );
  assert.match(
    route,
    /import\s*\{\s*hasMemoryAccess\s*\}\s*from\s*"@\/lib\/memory-gate"/,
  );
});

test("chat/route.ts: recall is gated on isVip", () => {
  const route = readText(join(ROOT, "src/app/api/chat/route.ts"));
  assert.match(route, /if \(isVip\)\s*\{[\s\S]{0,400}?recallMemory\(/);
});

test("chat/route.ts: extraction is async (non-blocking) and gated on hasMemoryAccess", () => {
  const route = readText(join(ROOT, "src/app/api/chat/route.ts"));
  assert.match(
    route,
    /void hasMemoryAccess\(user\.id\)\.then\(\(hasAccess\)[\s\S]{0,300}?extractMemories\(/,
  );
  assert.match(route, /\[memory\] extractMemories failed/);
});

test("chat/route.ts: vipMemorySection is injected into the system prompt array", () => {
  const route = readText(join(ROOT, "src/app/api/chat/route.ts"));
  assert.match(route, /vipMemorySection \|\| null/);
});

// --- 5. 记忆管理 API ---
test("api/memories/route.ts: GET handler with VIP guard + pagination", () => {
  const api = readText(join(ROOT, "src/app/api/memories/route.ts"));
  assert.match(api, /export async function GET/);
  assert.match(api, /hasMemoryAccess/);
  assert.match(api, /VIP_REQUIRED/);
  assert.match(api, /searchParams\.get\("page"\)/);
  assert.match(api, /searchParams\.get\("pageSize"\)/);
  assert.match(api, /searchParams\.get\("type"\)/);
  // 页面转纯壳后，VIP 剩余天数改由 API 随列表返回
  assert.match(api, /daysRemaining/);
  assert.match(api, /getActiveSubscription/);
});

test("api/memories/[id]/route.ts: DELETE + PUT handlers with VIP guard + ownership check", () => {
  const api = readText(join(ROOT, "src/app/api/memories/[id]/route.ts"));
  assert.match(api, /export async function DELETE/);
  assert.match(api, /export async function PUT/);
  assert.match(api, /eq\(petMemories\.userId,\s*user\.id\)/);
  assert.match(api, /Math\.max\(1,\s*Math\.min\(10/);
});

// --- 6. 记忆管理页面：VIP 拦截 + 渲染 ---
test("memories/page.tsx: 纯壳渲染 MemoriesClient（对齐 de6453d：SSR 不做 cookie 鉴权）", () => {
  const page = readText(join(ROOT, "src/app/[locale]/memories/page.tsx"));
  assert.match(page, /<MemoriesClient/);
  // 本站登录态只存 localStorage(aiabw_token)、全站不写 cookie，
  // SSR 读 cookie 恒为 null —— 页面壳不得再做 cookie/服务端鉴权/VIP 拦截
  assert.ok(!/cookies\(/.test(page), "page shell should not read cookies");
  assert.ok(!/verifyToken/.test(page), "page shell should not verify token");
  assert.ok(
    !/hasMemoryAccess|getActiveSubscription|redirect\("\/subscribe"\)/.test(page),
    "VIP/登录拦截应下沉到客户端 + API",
  );
});

test("memories-client.tsx: filters, list, edit, delete, modal, empty state, importance stars", () => {
  const client = readText(
    join(ROOT, "src/app/[locale]/memories/memories-client.tsx"),
  );
  assert.match(client, /useTranslations\("memories"\)/);
  assert.match(
    client,
    /TYPES:\s*MemoryType\[\]\s*=\s*\["preference",\s*"event",\s*"fact",\s*"emotion"\]/,
  );
  // 直引 t("xxx")：filterAll, edit, delete, save, cancel, loadMore, empty, importance, daysAgo, today
  for (const key of [
    "filterAll",
    "edit",
    "delete",
    "save",
    "cancel",
    "loadMore",
    "empty",
    "importance",
    "daysAgo",
    "today",
  ]) {
    // 文件中以 t("xxx" 形式出现，断言存在即可
    assert.ok(
      client.includes(`t("${key}"`),
      `memories-client should reference t("${key}")`,
    );
  }
  // 模板字符串 t(`filter${...}`) 用于 4 个 type
  assert.ok(
    client.includes("`filter${"),
    "memories-client should use t(`filter${...}`) template for type filters",
  );
  // 编辑/删除/确认文案（出现在 label/title/onClick 等位置）
  assert.ok(client.includes("deleteConfirm"));
  assert.ok(client.includes("editTitle"));
  // 编辑/删除 fetch
  assert.match(client, /method:\s*"PUT"/);
  assert.match(client, /method:\s*"DELETE"/);
  // Modal
  assert.match(client, /function Modal\(/);
  // 重要度星标
  assert.match(client, /function renderStars\(/);
  // 鉴权（对齐 de6453d）：localStorage token + Bearer + 未登录重定向 + 非 VIP 订阅引导
  assert.match(client, /localStorage\.getItem\("aiabw_token"\)/);
  assert.match(client, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(client, /login\?redirect=\/\$\{locale\}\/memories/);
  assert.match(client, /localStorage\.removeItem\("aiabw_token"\)/);
  assert.match(client, /"forbidden"/);
  assert.match(client, /t\("vipOnly"\)/);
  assert.match(client, /t\("subscribeNow"\)/);
  assert.match(client, /t\("vipDays"/);
});

// --- 7. 导航栏 Memory 入口（仅 VIP） ---
test("SiteHeader.tsx: 桌面端 / 移动端都有 /memories 入口，gated on me && sub && sub.isVip", () => {
  const header = readText(join(ROOT, "src/components/layout/SiteHeader.tsx"));
  const matches = header.match(/href="\/memories"/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `expected ≥2 /memories links, got ${matches.length}`,
  );
  const gates = header.match(/me\s*&&\s*sub\s*&&\s*sub\.isVip/g) ?? [];
  assert.ok(
    gates.length >= 2,
    `expected ≥2 me && sub && sub.isVip gates, got ${gates.length}`,
  );
  assert.match(header, /t\("navMemory"\)/);
  assert.match(header, /\ud83e\udde0/);
});

// --- 8. chat-panel：免费用户轻量引导 ---
test("chat-panel.tsx: MemoryHint renders only for non-VIP every 5 user messages", () => {
  const panel = readText(join(ROOT, "src/components/chat/chat-panel.tsx"));
  assert.match(panel, /function MemoryHint\(/);
  assert.match(panel, /userMsgCount\s*%\s*5\s*!==\s*0/);
  assert.match(panel, /t\("upgradeHint"\)/);
  assert.match(panel, /!\s*isVip\s*\?\s*<MemoryHint/);
});

// --- 9. i18n memories 命名空间 ---
test("i18n: zh.json has memories namespace with 24 keys", () => {
  const zh = readJson(join(ROOT, "messages/zh.json"));
  assert.ok(zh.memories, "zh.memories should exist");
  const keys = [
    "title",
    "subtitle",
    "filterAll",
    "filterPreference",
    "filterEvent",
    "filterFact",
    "filterEmotion",
    "importance",
    "edit",
    "delete",
    "deleteConfirm",
    "editTitle",
    "save",
    "cancel",
    "loadMore",
    "empty",
    "vipOnly",
    "upgradeHint",
    "subscribeNow",
    "vipDays",
    "loadFailed",
    "retry",
    "daysAgo",
    "today",
  ];
  for (const k of keys) {
    assert.equal(typeof zh.memories[k], "string", `zh.memories.${k} should be a string`);
    assert.ok(zh.memories[k].length > 0, `zh.memories.${k} should be non-empty`);
  }
  assert.equal(Object.keys(zh.memories).length, 24);
});

test("i18n: en.json has memories namespace with 24 keys", () => {
  const en = readJson(join(ROOT, "messages/en.json"));
  assert.ok(en.memories, "en.memories should exist");
  for (const k of [
    "title",
    "subtitle",
    "filterAll",
    "filterPreference",
    "filterEvent",
    "filterFact",
    "filterEmotion",
    "importance",
    "edit",
    "delete",
    "deleteConfirm",
    "editTitle",
    "save",
    "cancel",
    "loadMore",
    "empty",
    "vipOnly",
    "upgradeHint",
    "subscribeNow",
    "vipDays",
    "loadFailed",
    "retry",
    "daysAgo",
    "today",
  ]) {
    assert.equal(typeof en.memories[k], "string", `en.memories.${k} should be a string`);
  }
  assert.equal(Object.keys(en.memories).length, 24);
});

test("i18n: nav.navMemory exists in both locales", () => {
  const zh = readJson(join(ROOT, "messages/zh.json"));
  const en = readJson(join(ROOT, "messages/en.json"));
  assert.equal(typeof zh.nav.navMemory, "string");
  assert.equal(typeof en.nav.navMemory, "string");
});


