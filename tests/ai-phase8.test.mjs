// Phase 8 · AI 集成优化与成本控制（批次 8A：响应缓存 + LLM 降级）契约测试
//
// 覆盖（计划 9.2「缓存热门回复 / 降级策略」+ Phase 8 指令 2「备用模型切换 / 错误重试」）：
//  1) drizzle/0035：ai_response_cache + content_reports 两表 + 索引（含举报幂等 UNIQUE）；
//  2) client.ts：SCHEMA_VERSION 20 + 两表 DDL 入 SCHEMA_CREATES + 4 索引入 SCHEMA_INDEXES；
//  3) schema.ts：aiResponseCache / contentReports 两表定义导出；
//  4) get-model.ts：getModelCandidates（全部已配置 provider，优先级序）+ buildChatModel；
//  5) llm-fallback.ts：AiBusyError / 并发槽（AI_MAX_CONCURRENCY env）/ AggregateError /
//     跨 provider 循环重试 / generateCached 缓存优先 / generateThrottled 无缓存入口；
//  6) ai-cache.ts：sha256 归一化 key / 命中 UPDATE hits / 惰性过期 + 概率清理 /
//     UPSERT 写入 / 全链路 try-catch 容错（缓存故障不影响主流程）；
//  7) 接入点：name-suggestions（generateCached，TTL 7d + 预设池兜底保留）、
//     agent-psychology（generateThrottled + fallbackCopy 兜底保留）；
//  8) GET /api/admin/ai-stats：requireAdmin + 命中率口径 + 在途并发监控；
//  9) 红线：聊天 /api/chat 流式链路不引入缓存（千人千面 + SSE 重试语义）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

// ───────────── 1) drizzle/0035 迁移文件 ─────────────
test("phase8-8A: drizzle/0035_ai_safety.sql 两表 + 索引齐备且幂等", () => {
  const sql = read("drizzle/0035_ai_safety.sql");
  assert.ok(/CREATE TABLE IF NOT EXISTS "ai_response_cache"/.test(sql), "ai_response_cache table");
  assert.ok(/CREATE TABLE IF NOT EXISTS "content_reports"/.test(sql), "content_reports table");
  assert.ok(sql.includes('"cache_key"  text PRIMARY KEY'), "cache key text PK");
  assert.ok(sql.includes('"expires_at" timestamp NOT NULL'), "cache expiry column");
  assert.ok(sql.includes(`"status"      text DEFAULT 'pending' NOT NULL`), "report status default pending");
  assert.ok(sql.includes('"resolved_by" uuid'), "report resolver audit column");
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS "uq_content_reports_target"/.test(sql), "report idempotent UNIQUE index");
  assert.ok(sql.includes('"reporter_id", "target_type", "target_id"'), "UNIQUE covers reporter+target");
  assert.ok(sql.includes("idx_ai_cache_scope_expires"), "cache scope/expires index");
});

// ───────────── 2) client.ts 运行时同步 ─────────────
test("phase8-8A: client.ts SCHEMA_VERSION=20 + 两表 DDL + 4 索引", () => {
  const c = read("src/db/client.ts");
  assert.match(c, /const SCHEMA_VERSION = 20;/, "SCHEMA_VERSION bumped to 20");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "ai_response_cache"'), "cache DDL in SCHEMA_CREATES");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "content_reports"'), "reports DDL in SCHEMA_CREATES");
  for (const idx of [
    "idx_ai_cache_scope_expires",
    "idx_content_reports_status",
    "idx_content_reports_reporter",
    "uq_content_reports_target",
  ]) {
    assert.ok(c.includes(idx), `index ${idx} in SCHEMA_INDEXES`);
  }
  assert.ok(c.includes("db-migrate-prod.mjs"), "v20 comment warns manual prod migration");
});

// ───────────── 3) schema.ts 表定义 ─────────────
test("phase8-8A: schema.ts 导出 aiResponseCache / contentReports", () => {
  const s = read("src/db/schema.ts");
  assert.ok(s.includes("export const aiResponseCache = pgTable('ai_response_cache'"), "aiResponseCache table");
  assert.ok(s.includes("export const contentReports = pgTable('content_reports'"), "contentReports table");
  assert.ok(s.includes("expiresAt: timestamp('expires_at').notNull()"), "cache expiry mapping");
  assert.ok(s.includes("resolvedBy: uuid('resolved_by')"), "report resolver mapping");
});

// ───────────── 4) get-model.ts 候选链 ─────────────
test("phase8-8A: get-model.ts getModelCandidates 全量已配置 provider + buildChatModel", () => {
  const g = read("src/lib/get-model.ts");
  assert.ok(g.includes("export function getModelCandidates(): ModelCandidate[]"), "candidates exported");
  // 候选链保持 DEEPSEEK → OPENAI → BAILIAN 优先级
  const iCand = g.indexOf("getModelCandidates");
  const tail = g.slice(iCand);
  const ids = [...tail.matchAll(/id: '(deepseek|openai|bailian)'/g)].map((m) => m[1]);
  assert.deepEqual(ids.slice(0, 3), ["deepseek", "openai", "bailian"], "candidate priority order");
  assert.ok(g.includes("export function buildChatModel("), "buildChatModel exported");
  assert.ok(/export function getModel\(modelName\?: string\)/.test(g), "original getModel() preserved (chat 单点不变)");
});


// ───────────── 5) llm-fallback.ts 降级核心 ─────────────
test("phase8-8A: llm-fallback 并发限速 + 跨 provider 重试 + 组合入口", () => {
  const l = read("src/lib/llm-fallback.ts");
  assert.ok(l.includes("export class AiBusyError extends Error"), "AiBusyError signal");
  assert.ok(l.includes("process.env.AI_MAX_CONCURRENCY"), "concurrency env-tunable");
  assert.ok(l.includes("export function tryAcquireAiSlot(): boolean"), "non-blocking slot acquire");
  assert.ok(l.includes("export function releaseAiSlot(): void"), "slot release");
  assert.ok(l.includes("export async function generateWithFallback("), "fallback chain");
  assert.ok(l.includes("for (const c of candidates)"), "iterates all providers");
  assert.ok(l.includes('new AggregateError(errors, "all AI providers failed")'), "AggregateError on total failure");
  assert.ok(l.includes("if (text && text.trim())"), "empty response treated as failure");
  assert.ok(l.includes("export async function generateThrottled("), "no-cache throttled entry");
  assert.ok(l.includes("export async function generateCached("), "cached entry");
  assert.ok(l.includes("await getCachedAiResponse(opts.scope, cachePrompt)"), "cache read before LLM");
  assert.ok(l.includes("void setCachedAiResponse("), "async cache write (non-blocking)");
  // finally 释放槽位（防泄漏）
  assert.ok((l.match(/finally \{/g) ?? []).length >= 2, "slots released in finally");
  assert.ok((l.match(/releaseAiSlot\(\);/g) ?? []).length >= 2, "release calls in both entries");
});

// ───────────── 6) ai-cache.ts 缓存层 ─────────────
test("phase8-8A: ai-cache sha256 key + 命中计数 + 惰性过期 + UPSERT + 容错", () => {
  const a = read("src/lib/ai-cache.ts");
  assert.ok(a.includes('createHash("sha256")'), "sha256 prompt hash");
  assert.ok(a.includes('.replace(/\\s+/g, " ")'), "whitespace normalization");
  assert.ok(a.includes("`${scope}:${hash}`"), "scope-prefixed key");
  assert.ok(a.includes('UPDATE "ai_response_cache" SET hits = hits + 1'), "hit counter on read");
  assert.ok(a.includes("WHERE cache_key = $1 AND expires_at > now()"), "lazy expiry on read");
  assert.ok(a.includes('DELETE FROM "ai_response_cache" WHERE expires_at <= now()'), "probabilistic cleanup");
  assert.ok(a.includes("ON CONFLICT (cache_key) DO UPDATE SET"), "UPSERT write");
  assert.ok(a.includes("treated as miss"), "read failure falls back to miss");
  assert.ok(a.includes("write failed (skipped)"), "write failure non-fatal");
  assert.ok(a.includes('import { pool } from "@/db/client"'), "DB-backed (serverless 共享)");
});

// ───────────── 7) 接入点改造 ─────────────
test("phase8-8A: name-suggestions 走 generateCached + 预设池兜底保留", () => {
  const r = read("src/app/api/onboarding/name-suggestions/route.ts");
  assert.ok(r.includes('import { generateCached } from "@/lib/llm-fallback"'), "cached LLM entry");
  assert.ok(r.includes('scope: "name-suggestions"'), "cache scope");
  assert.ok(r.includes("cacheTtlDays: 7"), "7d TTL");
  assert.ok(!r.includes('import { getModel }'), "no direct getModel dependency");
  assert.ok(r.includes("FALLBACK_NAMES") && r.includes('source: "fallback"'), "fallback pool preserved");
  assert.ok(r.includes("parseNames"), "robust parsing preserved");
});

test("phase8-8A: agent-psychology 走 generateThrottled + fallbackCopy 兜底保留", () => {
  const a = read("src/lib/agent-psychology.ts");
  assert.ok(a.includes('import { generateThrottled } from "./llm-fallback"'), "throttled LLM entry");
  assert.ok(a.includes("await generateThrottled({"), "call site migrated");
  assert.ok(!a.includes('from "./get-model"'), "no direct getModel dependency");
  assert.ok(a.includes("fallbackCopy(platform, updates)"), "template fallback preserved");
  assert.ok(a.includes('source: "fallback"'), "fallback source flagged");
});

// ───────────── 8) admin 监控 API ─────────────
test("phase8-8A: GET /api/admin/ai-stats 命中率 + 并发监控（admin 守卫）", () => {
  const p = "src/app/api/admin/ai-stats/route.ts";
  assert.ok(exists(p), "route exists");
  const r = read(p);
  assert.ok(r.includes("requireAdmin(req)"), "admin guard");
  assert.ok(r.includes("GROUP BY scope"), "per-scope aggregation");
  assert.ok(r.includes("SUM(hits)"), "hits aggregated");
  assert.ok(r.includes("hitRate"), "hit rate exposed");
  assert.ok(r.includes("aiInFlight()") && r.includes("AI_MAX_CONCURRENCY"), "live concurrency exposed");
  assert.ok(r.includes("adminError("), "500 fallback");
});

// ───────────── 9) 红线：聊天流式链路不引入缓存 ─────────────
test("phase8-8A: 聊天 /api/chat 不接入响应缓存（千人千面 + SSE 语义）", () => {
  const c = read("src/app/api/chat/route.ts");
  assert.ok(!c.includes("ai-cache"), "no cache layer in chat");
  assert.ok(!c.includes("generateCached"), "no cached entry in chat");
  assert.ok(/model:\s*getModel\(\)/.test(c), "chat still uses getModel() single point");
});
