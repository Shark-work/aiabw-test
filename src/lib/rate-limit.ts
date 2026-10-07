/**
 * Phase 8 · API 请求频率限制（计划 9.4：关键端点限流 + 超限 429 友好提示）。
 *
 * 方案：固定窗口内存计数（与 login-security 同模式）。Serverless 下为单实例口径——
 * 不保证多实例精确配额，但足以削掉脚本/爬虫的尖峰（各实例独立限额，整体 ≈ N×limit，
 * 对「防滥用」场景可接受；精确全局限流需 Redis，接口不变可平滑替换）。
 * 超限统一 429 + Retry-After 头 + i18n 文案（api.rateLimited）。
 */
import { NextResponse } from "next/server";

import { apiError, resolveLocale } from "@/i18n/api-errors";

export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

/** 预设规则（成本敏感端点）。 */
export const RATE_LIMITS = {
  /** 聊天 20 次/分钟/用户（每日 quota 是主约束，本规则防秒级刷爆）。 */
  chat: { limit: 20, windowSec: 60 },
  /** 探索 12 次/分钟/用户（防脚本刷步数；日配额仍是主约束）。 */
  exploration: { limit: 12, windowSec: 60 },
  /** 举报 10 次/小时/用户（防举报轰炸刷管理后台）。 */
  reports: { limit: 10, windowSec: 3600 },
  /** UGC 发布 20 次/小时/创作者。 */
  ugcPublish: { limit: 20, windowSec: 3600 },
  /** 灵宠短视频生成 6 次/小时/用户（每日 video_quota 是主约束，本规则防连点刷可灵调用）。 */
  video: { limit: 6, windowSec: 3600 },
} satisfies Record<string, RateLimitRule>;

const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitVerdict {
  limited: boolean;
  retryAfterSec: number;
}

/** 固定窗口计数：key 级独立窗口，过期自动重置；超限返回 retryAfterSec。 */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitVerdict {
  const now = Date.now();
  const e = buckets.get(key);
  if (!e || now >= e.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowSec * 1000 });
    // 惰性清理：桶数过多时小概率清扫过期项，防内存膨胀
    if (buckets.size > 5000 && Math.random() < 0.05) {
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
      }
    }
    return { limited: false, retryAfterSec: 0 };
  }
  e.count += 1;
  if (e.count > rule.limit) {
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
  }
  return { limited: false, retryAfterSec: 0 };
}

/** 统一 429 响应：Retry-After 头 + i18n 文案（api.rateLimited）。 */
export function rateLimitResponse(req: Request, retryAfterSec: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: apiError(resolveLocale(req), "rateLimited"),
      code: "RATE_LIMITED",
      retryAfterSec,
    },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSec)) } },
  );
}
