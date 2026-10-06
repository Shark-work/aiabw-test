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

// ============================================================================
// 批次 8B：敏感词内容审核 + 用户举报 + admin 审核面板 + API 限流
// ============================================================================

// ───────────── 10) content-moderation 运行时行为（零依赖纯函数，直接 import） ─────────────
test("phase8-8B: moderateText 命中/绕过变体/放行 + 情绪词刻意不收", async () => {
  const { moderateText, filterClean, SENSITIVE_WORDS } = await import(
    "../src/lib/content-moderation.ts"
  );
  // 命中：直接包含
  assert.equal(moderateText("来赌博网站看看").ok, false, "direct hit");
  assert.deepEqual(moderateText("来赌博网站看看").hits, ["赌博"]);
  // 命中：空白/零宽拆词变体（归一化后仍命中）
  assert.equal(moderateText("赌 博 网 站").ok, false, "whitespace-split variant");
  assert.equal(moderateText("赌​博").ok, false, "zero-width variant");
  // 放行：正常宠物对话 / 情绪倾诉（刻意不收自杀/自残类词——陪伴产品应回应而非 400）
  assert.equal(moderateText("今天心情不好，陪陪我").ok, true, "emotional venting allowed");
  assert.equal(moderateText("我的小猫真可爱").ok, true, "normal text passes");
  assert.equal(moderateText("").ok, true, "empty passes");
  // 词表原则：不含情绪词（误伤成本 > 漏放成本）
  assert.ok(!SENSITIVE_WORDS.includes("自杀") && !SENSITIVE_WORDS.includes("自残"), "no emotional words in list");
  // filterClean：多候选过滤
  assert.deepEqual(filterClean(["雪球", "赌博王", "豆豆"], (s) => s), ["雪球", "豆豆"], "filters dirty candidates");
});

test("phase8-8B: content-moderation 词表结构 + news 口径复用", () => {
  const m = read("src/lib/content-moderation.ts");
  assert.ok(m.includes("export const SENSITIVE_WORDS"), "word list exported");
  assert.ok(m.includes("export function moderateText("), "moderateText exported");
  assert.ok(m.includes("export function filterClean<"), "filterClean exported");
  assert.ok(m.includes("INVISIBLE_RE"), "zero-width normalization");
  assert.ok(m.includes("String.fromCharCode(0x200b)"), "invisible chars via fromCharCode (源码无隐形字符)");
  // news 采集层既有词表仍在（两处并存：采集层 news.ts isBlockedContent 为抓取过滤，moderation 为 UGC 审核）
  assert.ok(read("src/lib/news.ts").includes("isBlockedContent"), "news collection filter preserved");
});

// ───────────── 11) rate-limit 固定窗口 ─────────────
test("phase8-8B: rate-limit 预设规则 + 固定窗口 + 429 响应", () => {
  const r = read("src/lib/rate-limit.ts");
  assert.ok(r.includes("export const RATE_LIMITS"), "presets exported");
  assert.ok(r.includes("chat: { limit: 20, windowSec: 60 }"), "chat 20/min");
  assert.ok(r.includes("exploration: { limit: 12, windowSec: 60 }"), "exploration 12/min");
  assert.ok(r.includes("reports: { limit: 10, windowSec: 3600 }"), "reports 10/hour");
  assert.ok(r.includes("ugcPublish: { limit: 20, windowSec: 3600 }"), "ugc publish 20/hour");
  assert.ok(r.includes("export function checkRateLimit("), "fixed-window counter");
  assert.ok(r.includes("{ status: 429, headers: { \"Retry-After\""), "429 + Retry-After header");
  assert.ok(r.includes('apiError(resolveLocale(req), "rateLimited")'), "i18n error message");
  assert.ok(r.includes("code: \"RATE_LIMITED\""), "structured code");
});

// ───────────── 12) chat 接入：限流 + 审核（且先于 LLM/quota） ─────────────
test("phase8-8B: chat 限流 + 敏感词 400，位于 LLM 调用之前", () => {
  const c = read("src/app/api/chat/route.ts");
  assert.ok(c.includes('import { moderateText } from "@/lib/content-moderation"'), "moderation imported");
  assert.ok(c.includes('checkRateLimit(`chat:${user.id}`, RATE_LIMITS.chat)'), "chat rate limit wired");
  assert.ok(c.includes("uiMessageText(lastUserMsg)"), "last user message extracted");
  assert.ok(c.includes('code: "CONTENT_MODERATED"'), "moderated code");
  assert.ok(c.includes('apiError(locale, "inappropriateContent")'), "i18n moderated error");
  // 顺序红线：限流+审核必须先于 LLM streamText 与 quota 递增（省成本 + 不占配额）
  const iRL = c.indexOf("checkRateLimit(`chat:");
  const iMod = c.indexOf("uiMessageText(lastUserMsg)");
  const iStream = c.indexOf("streamText(");
  assert.ok(iRL > -1 && iStream > -1 && iRL < iStream, "rate limit before streamText");
  assert.ok(iMod > -1 && iMod < iStream, "moderation before streamText");
});

// ───────────── 13) exploration/creator/adopt/name-suggestions 接入 ─────────────
test("phase8-8B: exploration/start 限流 + creator 限流审核 + adopt 审核 + 起名输出过滤", () => {
  const ex = read("src/app/api/exploration/start/route.ts");
  assert.ok(ex.includes("checkRateLimit(`explore:${user.id}`, RATE_LIMITS.exploration)"), "exploration rate limit");
  assert.ok(ex.indexOf("checkRateLimit(`explore:") < ex.indexOf("pickWeightedEvent("), "limit before event roll");

  const pub = read("src/app/api/creator/publish/route.ts");
  assert.ok(pub.includes("checkRateLimit(`ugc:${user.id}`, RATE_LIMITS.ugcPublish)"), "ugc publish rate limit");
  assert.ok(pub.includes("moderateText(name)") && pub.includes("moderateText(systemPrompt)"), "name+prompt moderated");
  assert.ok(pub.indexOf("moderateText(name)") < pub.indexOf(".insert(ugcPets)"), "moderation before insert");

  const adopt = read("src/app/api/adopt/route.ts");
  assert.ok(adopt.includes("moderateText(petName)"), "pet name moderated");
  assert.ok(adopt.includes('code: "CONTENT_MODERATED"'), "adopt moderated code");

  const ns = read("src/app/api/onboarding/name-suggestions/route.ts");
  assert.ok(ns.includes("filterClean(parseNames(text ?? \"\"), (s) => s)"), "AI names filtered");
  assert.ok(
    ns.indexOf("filterClean(parseNames") < ns.indexOf('ok: true, names, source: "ai"'),
    "filter before ai response",
  );
});

// ───────────── 14) POST /api/reports 用户举报 ─────────────
test("phase8-8B: POST /api/reports 枚举校验 + 幂等 + 限流 + 401", () => {
  const p = "src/app/api/reports/route.ts";
  assert.ok(exists(p), "route exists");
  const r = read(p);
  assert.ok(r.includes("getUserFromRequest(req)"), "auth");
  assert.ok(r.includes("{ status: 401 }"), "unauthenticated 401");
  assert.ok(r.includes('new Set(["chat", "pet_name", "ugc_pet", "postcard", "news"])'), "target type enum");
  assert.ok(r.includes('new Set(["spam", "nsfw", "abuse", "illegal", "other"])'), "reason enum");
  assert.ok(r.includes("checkRateLimit(`reports:${user.id}`, RATE_LIMITS.reports)"), "report rate limit");
  assert.ok(
    r.includes('ON CONFLICT ("reporter_id", "target_type", "target_id") DO NOTHING'),
    "idempotent insert (uq index)",
  );
  assert.ok(r.includes("alreadyReported"), "duplicate flag returned");
  assert.ok(r.includes('apiError(locale, "invalidReport")'), "400 invalid report");
  assert.ok(r.includes('apiError(locale, "reportFailed")'), "500 fallback");
});

// ───────────── 15) admin 审核 API ─────────────
test("phase8-8B: admin reports 列表（pending 先报先审）+ 处置（仅 pending + 审计）", () => {
  const g = read("src/app/api/admin/reports/route.ts");
  assert.ok(g.includes("requireAdmin(req)"), "GET admin guard");
  assert.ok(g.includes('LEFT JOIN "users" u ON u.id = r.reporter_id'), "reporter email joined");
  assert.ok(g.includes("WHEN r.status = 'pending' THEN 0 ELSE 1 END"), "pending first");
  assert.ok(g.includes("LIMIT ${pageSize} OFFSET"), "pagination");

  const p = read("src/app/api/admin/reports/[id]/route.ts");
  assert.ok(p.includes("requireAdmin(req)"), "PATCH admin guard");
  assert.ok(p.includes('action === "resolve" ? "resolved"'), "resolve→resolved");
  assert.ok(p.includes('action === "dismiss" ? "dismissed"'), "dismiss→dismissed");
  assert.ok(p.includes("WHERE id = $3 AND status = 'pending'"), "only pending resolvable");
  assert.ok(p.includes("resolved_by = $2::uuid"), "audit: operator recorded");
  assert.ok(p.includes("{ status: 409 }"), "409 on repeat resolve");
});

// ───────────── 16) admin/moderation 页 + nav 挂载（顺带修复 admin-shell mojibake） ─────────────
test("phase8-8B: /admin/moderation 页 + admin-shell 菜单挂载 + mojibake 已修复", () => {
  const pg = "src/app/admin/moderation/page.tsx";
  assert.ok(exists(pg), "page exists");
  const c = read(pg);
  assert.ok(c.includes("/api/admin/reports?"), "loads report queue");
  assert.ok(c.includes('action === "resolve" ? "已确认违规" : "已驳回举报"'), "resolve/dismiss actions");
  assert.ok(c.includes("先报先审"), "pending FIFO copy");
  // AI 成本监控条（计划 9.2 缓存命中率监控可视化）
  assert.ok(c.includes('fetch("/api/admin/ai-stats"'), "ai-stats fetched");
  assert.ok(c.includes("缓存命中率"), "hit rate displayed");
  assert.ok(c.includes("在途并发"), "live concurrency displayed");

  const shell = read("src/components/admin/admin-shell.tsx");
  assert.ok(shell.includes('{ href: "/admin/moderation", label: "🛡️ 内容审核" }'), "nav item mounted");
  // mojibake 修复回归：菜单/注释不得再含固化乱码字符
  assert.ok(!/馃|鈿|鏁版|瀹犵墿绠|绯荤粺璁/.test(shell), "no mojibake residue in admin shell");
  assert.ok(shell.includes("📊 数据看板"), "dashboard label restored");
});

// ───────────── 17) i18n：4 个新 api key 双语 parity ─────────────
test("phase8-8B: i18n api 新 key 双语 parity（rateLimited/inappropriateContent/invalidReport/reportFailed）", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const key of ["rateLimited", "inappropriateContent", "invalidReport", "reportFailed"]) {
    assert.ok(zh.api[key], `zh api.${key} exists`);
    assert.ok(en.api[key], `en api.${key} exists`);
    assert.ok(typeof zh.api[key] === "string" && zh.api[key].length > 3, `zh ${key} non-trivial`);
    assert.ok(typeof en.api[key] === "string" && en.api[key].length > 3, `en ${key} non-trivial`);
  }
  // 修复键后 api 命名空间 key 集合双语一致（防漏译）
  assert.deepEqual(Object.keys(en.api).sort(), Object.keys(zh.api).sort(), "api key set parity");
});

