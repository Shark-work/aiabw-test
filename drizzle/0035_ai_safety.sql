-- Phase 8 · AI 集成优化与成本控制（2026-10-16，SCHEMA_VERSION 20）
--  1) ai_response_cache  AI 响应缓存：scope+prompt 哈希主键；hits 计数供命中率监控；
--     expires_at 惰性过期（读时判定 + 概率清理）
--  2) content_reports    用户举报：同一举报人对同一目标仅一条（uq 索引天然幂等）；
--     状态流转 pending → resolved / dismissed（admin 审核面板）
-- 幂等：CREATE TABLE IF NOT EXISTS / CREATE [UNIQUE] INDEX IF NOT EXISTS，可重复执行。

CREATE TABLE IF NOT EXISTS "ai_response_cache" (
  "cache_key"  text PRIMARY KEY,
  "scope"      text NOT NULL,
  "response"   text NOT NULL,
  "hits"       integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_reports" (
  "id"          text PRIMARY KEY,
  "reporter_id" uuid NOT NULL REFERENCES "users"("id"),
  "target_type" text NOT NULL,
  "target_id"   text NOT NULL,
  "reason"      text NOT NULL,
  "detail"      text,
  "status"      text DEFAULT 'pending' NOT NULL,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "resolved_by" uuid
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ai_cache_scope_expires" ON "ai_response_cache" ("scope", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_reports_status" ON "content_reports" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_reports_reporter" ON "content_reports" ("reporter_id", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_content_reports_target" ON "content_reports" ("reporter_id", "target_type", "target_id");
